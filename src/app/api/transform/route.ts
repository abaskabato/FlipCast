import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { videoJobs, jobOutputs } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';
import { RATIOS, checkQuota } from '@/lib/quotas';
import type { RatioId } from '@/lib/quotas';
import { reserveUsage, releaseUsage, type UsageSnapshot } from '@/lib/usage';

export const runtime = 'nodejs';

type StartRequest = {
  fileName?: string;
  targets?: string[];
  mode?: 'auto_center' | 'smart_face' | 'manual_crop';
  sourceDurationSeconds?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  sourceSizeBytes?: number;
};

const VALID_MODES = ['auto_center', 'smart_face', 'manual_crop'] as const;

/** Concurrent renders allowed per account, to stop runaway tab fleets. */
const MAX_ACTIVE_JOBS = 3;

function newId(): string {
  return crypto.randomUUID();
}

function fail(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

/**
 * Start a render job.
 *
 * This does NOT transcode anything: the browser engine does that work locally
 * (see src/lib/video/ffmpeg-client.ts). This endpoint's job is to authorise
 * the render and reserve quota, then record what the user asked for.
 */
export async function POST(request: Request) {
  const ip = clientIp(request.headers);
  if (!checkRateLimit(`transform:${ip}`, 20, 60_000)) {
    return fail(429, 'Too many requests. Try again in a moment.');
  }

  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session?.user?.id) {
    return fail(401, 'Sign in to start a render.');
  }
  const userId = session.user.id;

  let body: StartRequest;
  try {
    body = await request.json();
  } catch {
    return fail(400, 'Invalid JSON body.');
  }

  const { fileName, targets, mode, sourceDurationSeconds } = body;
  if (!fileName || !Array.isArray(targets) || targets.length === 0) {
    return fail(400, 'fileName and at least one target are required.');
  }
  if (targets.length > RATIOS.length) {
    return fail(400, 'Too many output formats requested.');
  }
  const validTargets = targets.filter((t): t is RatioId =>
    (RATIOS as readonly string[]).includes(t),
  );
  if (validTargets.length !== targets.length) {
    return fail(400, `targets must be a subset of ${RATIOS.join(', ')}.`);
  }
  const normalizedMode = mode && VALID_MODES.includes(mode) ? mode : 'auto_center';

  try {
    // Advisory pre-check so we can return a friendly message before touching
    // the database. The authoritative check is the atomic reservation below,
    // which re-reads the tier from the DB.
    //
    // Note the tier is never accepted from the request body: it is written only
    // by the Stripe webhook. A client-settable tier would make the paywall
    // bypassable from devtools.
    const tier = (session.user as { subscriptionTier?: string }).subscriptionTier ?? 'free';
    const decision = checkQuota({
      tier,
      used: 0,
      seconds: Number(sourceDurationSeconds ?? 0),
      limitOverride: (session.user as { maxUsageLimit?: number | null }).maxUsageLimit ?? null,
    });
    if (!decision.ok && decision.reason.includes('longer than')) {
      return fail(413, decision.reason);
    }

    const reservation = await reserveUsage(userId, Number(sourceDurationSeconds ?? 0));
    if (!reservation.ok) {
      return NextResponse.json(
        { error: reservation.error, usage: reservation.usage },
        { status: reservation.status },
      );
    }
    const usage: UsageSnapshot = reservation.usage;

    const jobId = newId();
    await db.insert(videoJobs).values({
      id: jobId,
      userId,
      originalName: String(fileName).slice(0, 200),
      renderEngine: 'browser',
      status: 'rendering',
      trackingMode: normalizedMode,
      sourceWidth: numOrNull(body.sourceWidth),
      sourceHeight: numOrNull(body.sourceHeight),
      sourceDurationSeconds: numOrNull(body.sourceDurationSeconds),
      sourceSizeBytes: numOrNull(body.sourceSizeBytes),
      reservedSeconds: Math.max(0, Math.round(Number(sourceDurationSeconds ?? 0))),
      progress: 0,
      startedAt: new Date(),
    });

    await db.insert(jobOutputs).values(
      validTargets.map((ratio) => ({
        id: newId(),
        jobId,
        ratio,
        status: 'rendering' as const,
      })),
    );

    return NextResponse.json({
      success: true,
      jobId,
      targets: validTargets,
      usage,
    });
  } catch (e) {
    console.error('transform start error', e);
    return fail(503, 'Could not start the render. Please try again.');
  }
}

/**
 * Report terminal state for a job.
 *
 * On failure the reserved quota is refunded. On success the reservation is
 * kept and the outputs are recorded so history and downloads work.
 */
export async function PATCH(request: Request) {
  const ip = clientIp(request.headers);
  if (!checkRateLimit(`transform-complete:${ip}`, 60, 60_000)) {
    return fail(429, 'Too many requests.');
  }

  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session?.user?.id) return fail(401, 'Sign in to update a render.');

  let body: {
    jobId?: string;
    status?: 'completed' | 'failed' | 'canceled';
    error?: string;
    outputs?: { ratio: string; sizeBytes?: number; width?: number; height?: number }[];
  };
  try {
    body = await request.json();
  } catch {
    return fail(400, 'Invalid JSON body.');
  }

  const { jobId, status } = body;
  if (!jobId || !status) return fail(400, 'jobId and status are required.');
  if (!['completed', 'failed', 'canceled'].includes(status)) {
    return fail(400, 'Invalid status.');
  }

  const userId = session.user.id;
  try {
    const rows = await db
      .select()
      .from(videoJobs)
      .where(eq(videoJobs.id, jobId))
      .limit(1);
    const job = rows[0];
    if (!job) return fail(404, 'Render not found.');
    // Never let one user complete another user's job.
    if (job.userId !== userId) return fail(403, 'That render belongs to another account.');

    const now = new Date();
    if (status === 'completed') {
      await db
        .update(videoJobs)
        .set({ status: 'completed', progress: 100, completedAt: now, error: null })
        .where(eq(videoJobs.id, jobId));

      const outputs = (body.outputs ?? []).filter((o) =>
        (RATIOS as readonly string[]).includes(o.ratio),
      );
      if (outputs.length > 0) {
        await db
          .update(jobOutputs)
          .set({ status: 'completed', completedAt: now, progress: 100 })
          .where(eq(jobOutputs.jobId, jobId));
      }
      return NextResponse.json({ success: true, jobId, status });
    }

    // Failed or canceled: refund the reservation, record why.
    await db
      .update(videoJobs)
      .set({ status, error: String(body.error ?? '').slice(0, 500) || null, completedAt: now })
      .where(eq(videoJobs.id, jobId));
    await db.update(jobOutputs).set({ status }).where(eq(jobOutputs.jobId, jobId));

    if (job.reservedSeconds) {
      await releaseUsage(userId, job.reservedSeconds);
    }
    return NextResponse.json({ success: true, jobId, status, refunded: job.reservedSeconds ?? 0 });
  } catch (e) {
    console.error('transform complete error', e);
    return fail(503, 'Could not update the render.');
  }
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}