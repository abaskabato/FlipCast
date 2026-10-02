import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { user as userTable, videoJobs, jobOutputs } from '@/db/schema';
import { checkQuota, tierLimit, type QuotaDecision } from './quotas';

/**
 * Usage accounting.
 *
 * Rendering happens in the browser, so the server cannot measure work itself.
 * Instead it trusts a duration the client reported, then *reserves* it up
 * front. Reservation (rather than increment-on-completion) is what stops N
 * concurrent tabs from each passing a pre-check and collectively blowing past
 * the limit.
 *
 * The `WHERE used + n <= limit` guard in {@link reserveUsage} makes the check
 * and the increment a single atomic statement, so parallel requests cannot
 * interleave into a negative effective balance.
 */

/** Reset the window if the user's last usage period has elapsed. */
function periodStartFor(periodStart: Date | null): Date {
  const now = new Date();
  const start = periodStart ?? now;
  // Monthly periods: roll over on the same day-of-month, or on the 1st.
  if (now.getUTCFullYear() !== start.getUTCFullYear() || now.getUTCMonth() !== start.getUTCMonth()) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  return start;
}

export type UsageSnapshot = {
  tier: string;
  usedSeconds: number;
  limitSeconds: number;
  remainingSeconds: number;
  periodStart: string;
};

export async function getUsage(userId: string): Promise<UsageSnapshot | null> {
  const rows = await db
    .select({
      tier: userTable.subscriptionTier,
      used: userTable.monthlyUsageSeconds,
      override: userTable.maxUsageLimit,
      periodStart: userTable.usagePeriodStart,
    })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const limit = row.override ?? tierLimit(row.tier);
  const periodStart = periodStartFor(row.periodStart);
  const stale = periodStart.getTime() !== (row.periodStart ?? periodStart).getTime();

  // Lazily reset an elapsed window so the UI never shows stale usage.
  if (stale) {
    await db
      .update(userTable)
      .set({ monthlyUsageSeconds: 0, usagePeriodStart: periodStart })
      .where(eq(userTable.id, userId));
  }

  const used = stale ? 0 : Math.max(0, row.used);
  return {
    tier: row.tier,
    usedSeconds: used,
    limitSeconds: limit,
    remainingSeconds: Math.max(0, limit - used),
    periodStart: periodStart.toISOString(),
  };
}

export type ReserveResult =
  | { ok: true; usage: UsageSnapshot }
  | { ok: false; status: 402 | 413; error: string; usage: UsageSnapshot };

/**
 * Atomically reserve `seconds` of quota, or reject if the user cannot afford it.
 */
export async function reserveUsage(
  userId: string,
  seconds: number,
): Promise<ReserveResult | { ok: false; status: 404; error: string; usage: UsageSnapshot }> {
  const snapshot = await getUsage(userId);
  if (!snapshot) {
    return { ok: false, status: 404, error: 'Profile not found', usage: emptyUsage() };
  }

  const wanted = Math.max(0, Math.round(seconds));

  // Single atomic UPDATE ... WHERE guard: no read-modify-write race.
  const updated = await db
    .update(userTable)
    .set({
      monthlyUsageSeconds: sql`${userTable.monthlyUsageSeconds} + ${wanted}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(userTable.id, userId),
        sql`${userTable.monthlyUsageSeconds} + ${wanted} <= coalesce(${userTable.maxUsageLimit}, ${tierLimitForSql(snapshot.tier)})`,
      ),
    )
    .returning({
      used: userTable.monthlyUsageSeconds,
      override: userTable.maxUsageLimit,
      tier: userTable.subscriptionTier,
      periodStart: userTable.usagePeriodStart,
    });

  const row = updated[0];
  if (!row) {
    // The guard rejected it: someone else consumed the remaining quota, or the
    // requested amount exceeds it. Report the live numbers.
    const live = (await getUsage(userId)) ?? snapshot;
    const decision = checkQuota({
      tier: live.tier,
      used: live.usedSeconds,
      seconds: wanted,
      limitOverride: live.limitSeconds,
    });
    if (decision.ok) {
      // Guard rejected but a fresh check passes: the window rolled over
      // between our read and the update. Tell the client to retry.
      return { ok: false, status: 402, error: 'Quota window just reset. Please retry.', usage: live };
    }
    const status: 402 | 413 = decision.reason.includes('longer than') ? 413 : 402;
    return { ok: false, status, error: decision.reason, usage: live };
  }

  const limit = row.override ?? tierLimit(row.tier);
  const used = Math.max(0, row.used);
  return {
    ok: true,
    usage: {
      tier: row.tier,
      usedSeconds: used,
      limitSeconds: limit,
      remainingSeconds: Math.max(0, limit - used),
      periodStart: (row.periodStart ?? new Date()).toISOString(),
    },
  };
}

/** Give back a reservation when a render never produced anything usable. */
export async function releaseUsage(userId: string, seconds: number): Promise<void> {
  const back = Math.max(0, Math.round(seconds));
  if (back === 0) return;
  await db
    .update(userTable)
    .set({
      monthlyUsageSeconds: sql`greatest(0, ${userTable.monthlyUsageSeconds} - ${back})`,
      updatedAt: new Date(),
    })
    .where(eq(userTable.id, userId));
}

function tierLimitForSql(tier: string): number {
  return tierLimit(tier);
}

function emptyUsage(): UsageSnapshot {
  return {
    tier: 'free',
    usedSeconds: 0,
    limitSeconds: tierLimit('free'),
    remainingSeconds: tierLimit('free'),
    periodStart: new Date().toISOString(),
  };
}

/**
 * Renders still plausibly in progress. A job whose tab was closed never reports
 * a terminal state, so anything older than the window is treated as abandoned
 * rather than counted forever.
 */
export async function countActiveJobs(userId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(videoJobs)
    .where(
      and(
        eq(videoJobs.userId, userId),
        sql`${videoJobs.status} in ('pending','rendering')`,
        sql`${videoJobs.startedAt} > now() - interval '2 hours'`,
      ),
    );
  return rows[0]?.n ?? 0;
}

export { jobOutputs };