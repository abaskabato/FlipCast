/**
 * Connected accounts and posts in the database, and the one place access
 * tokens are decrypted and refreshed.
 *
 * Node only.
 */

import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, lte, or } from 'drizzle-orm';

import { db } from '@/db';
import { scheduledPosts, socialAccounts, type PostStatus, type SocialPlatform } from '@/db/schema';
import { decryptToken, encryptToken } from './crypto';
import { tiktokRefresh } from './tiktok';
import { youtubeRefresh, type Tokens } from './youtube';

export type AccountRow = typeof socialAccounts.$inferSelect;
export type PostRow = typeof scheduledPosts.$inferSelect;

/** What the browser may see about an account: never tokens. */
export type PublicAccount = {
  id: string;
  platform: SocialPlatform;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
};

export const toPublic = (a: AccountRow): PublicAccount => ({
  id: a.id,
  platform: a.platform,
  displayName: a.displayName,
  avatarUrl: a.avatarUrl,
  createdAt: a.createdAt.toISOString(),
});

/** Connect or reconnect: one row per user, platform and external account. */
export async function saveAccount(input: {
  userId: string;
  platform: SocialPlatform;
  externalId: string;
  displayName: string;
  avatarUrl: string | null;
  tokens: Tokens;
}): Promise<AccountRow> {
  const values = {
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    accessTokenEnc: encryptToken(input.tokens.accessToken),
    accessTokenExpiresAt: input.tokens.expiresAt,
    scope: input.tokens.scope,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(socialAccounts)
    .values({
      id: randomUUID(),
      userId: input.userId,
      platform: input.platform,
      externalId: input.externalId,
      refreshTokenEnc: input.tokens.refreshToken ? encryptToken(input.tokens.refreshToken) : null,
      ...values,
    })
    .onConflictDoUpdate({
      target: [socialAccounts.userId, socialAccounts.platform, socialAccounts.externalId],
      // Google only returns a refresh token on first consent; keep the old one otherwise.
      set: input.tokens.refreshToken ? { ...values, refreshTokenEnc: encryptToken(input.tokens.refreshToken) } : values,
    })
    .returning();
  return row;
}

export async function listAccounts(userId: string): Promise<AccountRow[]> {
  return db.select().from(socialAccounts).where(eq(socialAccounts.userId, userId)).orderBy(asc(socialAccounts.createdAt));
}

export async function getAccount(userId: string, id: string): Promise<AccountRow | null> {
  const [row] = await db
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.id, id), eq(socialAccounts.userId, userId)));
  return row ?? null;
}

export async function deleteAccount(userId: string, id: string): Promise<AccountRow | null> {
  const [row] = await db
    .delete(socialAccounts)
    .where(and(eq(socialAccounts.id, id), eq(socialAccounts.userId, userId)))
    .returning();
  return row ?? null;
}

/** Refresh this long before expiry, so an upload never starts on a dying token. */
const REFRESH_MARGIN_MS = 5 * 60_000;

/**
 * A usable access token for `account`, refreshed (and the new tokens stored)
 * when it is close to expiring. Throws PlatformError with `reconnect` when
 * the user has revoked access.
 */
export async function accessTokenFor(account: AccountRow): Promise<string> {
  const fresh = account.accessTokenExpiresAt && account.accessTokenExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS;
  if (fresh) return decryptToken(account.accessTokenEnc);
  if (!account.refreshTokenEnc) return decryptToken(account.accessTokenEnc);

  const refresh = decryptToken(account.refreshTokenEnc);
  const tokens = account.platform === 'youtube' ? await youtubeRefresh(refresh) : await tiktokRefresh(refresh);
  await db
    .update(socialAccounts)
    .set({
      accessTokenEnc: encryptToken(tokens.accessToken),
      accessTokenExpiresAt: tokens.expiresAt,
      // TikTok rotates refresh tokens; Google usually does not send one.
      ...(tokens.refreshToken ? { refreshTokenEnc: encryptToken(tokens.refreshToken) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(socialAccounts.id, account.id));
  return tokens.accessToken;
}

// ---- posts ---------------------------------------------------------------------

export async function createPost(values: Omit<typeof scheduledPosts.$inferInsert, 'id'>): Promise<PostRow> {
  const [row] = await db.insert(scheduledPosts).values({ id: randomUUID(), ...values }).returning();
  return row;
}

export async function updatePost(id: string, values: Partial<typeof scheduledPosts.$inferInsert>): Promise<void> {
  await db.update(scheduledPosts).set({ ...values, updatedAt: new Date() }).where(eq(scheduledPosts.id, id));
}

export async function getPost(userId: string, id: string): Promise<PostRow | null> {
  const [row] = await db
    .select()
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.id, id), eq(scheduledPosts.userId, userId)));
  return row ?? null;
}

export async function listPosts(userId: string, limit = 50): Promise<(PostRow & { accountName: string })[]> {
  const rows = await db
    .select({ post: scheduledPosts, accountName: socialAccounts.displayName })
    .from(scheduledPosts)
    .innerJoin(socialAccounts, eq(scheduledPosts.socialAccountId, socialAccounts.id))
    .where(eq(scheduledPosts.userId, userId))
    .orderBy(desc(scheduledPosts.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r.post, accountName: r.accountName }));
}

/**
 * Claim TikTok posts that are due (or stuck mid-send for over 15 minutes), so
 * two overlapping scheduler runs never send the same post twice: the claim
 * is a conditional update, and only rows it actually changed are returned.
 */
export async function claimDuePosts(now: Date, limit = 3): Promise<PostRow[]> {
  const stuck = new Date(now.getTime() - 15 * 60_000);
  const due = await db
    .select({ id: scheduledPosts.id })
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.platform, 'tiktok'),
        or(
          and(eq(scheduledPosts.status, 'scheduled'), or(isNull(scheduledPosts.scheduledAt), lte(scheduledPosts.scheduledAt, now))),
          and(eq(scheduledPosts.status, 'posting'), lte(scheduledPosts.updatedAt, stuck)),
        ),
      ),
    )
    .orderBy(asc(scheduledPosts.scheduledAt))
    .limit(limit);
  if (!due.length) return [];
  return db
    .update(scheduledPosts)
    .set({ status: 'posting', updatedAt: now })
    .where(
      and(
        inArray(
          scheduledPosts.id,
          due.map((d) => d.id),
        ),
        or(eq(scheduledPosts.status, 'scheduled'), and(eq(scheduledPosts.status, 'posting'), lte(scheduledPosts.updatedAt, stuck))),
      ),
    )
    .returning();
}

/** TikTok posts still being processed by TikTok, to check on. */
export async function processingPosts(limit = 10): Promise<PostRow[]> {
  return db
    .select()
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.platform, 'tiktok'), eq(scheduledPosts.status, 'processing' as PostStatus)))
    .orderBy(asc(scheduledPosts.updatedAt))
    .limit(limit);
}

export async function accountById(id: string): Promise<AccountRow | null> {
  const [row] = await db.select().from(socialAccounts).where(eq(socialAccounts.id, id));
  return row ?? null;
}
