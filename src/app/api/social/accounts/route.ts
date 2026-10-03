import { NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import { and, eq, isNotNull } from 'drizzle-orm';

import { db } from '@/db';
import { scheduledPosts } from '@/db/schema';
import { decryptToken } from '@/lib/social/crypto';
import { jsonError, userIdFrom } from '@/lib/social/http';
import { deleteAccount, getAccount, listAccounts, toPublic } from '@/lib/social/store';
import { tiktokRevoke } from '@/lib/social/tiktok';
import { youtubeRevoke } from '@/lib/social/youtube';

export const runtime = 'nodejs';

/** GET: the signed-in user's connected accounts (never tokens). */
export async function GET(request: Request) {
  const userId = await userIdFrom(request);
  if (!userId) return jsonError('Sign in first.', 401);
  return NextResponse.json({ accounts: (await listAccounts(userId)).map(toPublic) });
}

/**
 * DELETE ?id=: disconnect. Revokes the token with the platform, deletes any
 * clips waiting to be posted to this account, then the account (its posts go
 * with it).
 */
export async function DELETE(request: Request) {
  const userId = await userIdFrom(request);
  if (!userId) return jsonError('Sign in first.', 401);
  const id = new URL(request.url).searchParams.get('id') ?? '';
  const account = await getAccount(userId, id);
  if (!account) return jsonError('No such account.', 404);

  try {
    const token = decryptToken(account.refreshTokenEnc ?? account.accessTokenEnc);
    await (account.platform === 'youtube' ? youtubeRevoke(token) : tiktokRevoke(decryptToken(account.accessTokenEnc)));
  } catch {
    // Revocation is best effort; the tokens are deleted either way.
  }
  const waiting = await db
    .select({ pathname: scheduledPosts.blobPathname })
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.socialAccountId, id), isNotNull(scheduledPosts.blobPathname)));
  if (waiting.length && process.env.BLOB_READ_WRITE_TOKEN) {
    await del(waiting.map((w) => w.pathname!)).catch(() => undefined);
  }
  await deleteAccount(userId, id);
  return NextResponse.json({ ok: true });
}
