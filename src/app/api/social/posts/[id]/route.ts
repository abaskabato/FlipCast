import { NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import { z } from 'zod';

import { jsonError, userIdFrom } from '@/lib/social/http';
import { accessTokenFor, accountById, getPost, updatePost } from '@/lib/social/store';
import { tiktokStatus } from '@/lib/social/tiktok';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const Report = z.discriminatedUnion('result', [
  z.object({ result: z.literal('uploaded'), videoId: z.string().optional() }),
  z.object({ result: z.literal('failed'), error: z.string().max(400) }),
]);

/** PATCH: the browser reports how its direct upload to the platform went. */
export async function PATCH(request: Request, { params }: Ctx) {
  const userId = await userIdFrom(request);
  if (!userId) return jsonError('Sign in first.', 401);
  const post = await getPost(userId, (await params).id);
  if (!post || post.status !== 'uploading') return jsonError('No upload in progress for that post.', 404);
  const parsed = Report.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('Bad report.', 400);
  const r = parsed.data;

  if (r.result === 'failed') {
    await updatePost(post.id, { status: 'failed', error: r.error });
  } else if (post.platform === 'youtube') {
    if (!r.videoId) return jsonError('Missing video ID.', 400);
    const later = post.scheduledAt && post.scheduledAt.getTime() > Date.now();
    await updatePost(post.id, {
      status: later ? 'scheduled' : 'posted',
      externalId: r.videoId,
      url: `https://youtu.be/${r.videoId}`,
      postedAt: later ? null : new Date(),
    });
  } else {
    // TikTok now processes it; GET checks on the outcome.
    await updatePost(post.id, { status: 'processing' });
  }
  return NextResponse.json({ ok: true });
}

/** GET: one post, checking TikTok for the outcome while it is processing. */
export async function GET(request: Request, { params }: Ctx) {
  const userId = await userIdFrom(request);
  if (!userId) return jsonError('Sign in first.', 401);
  let post = await getPost(userId, (await params).id);
  if (!post) return jsonError('No such post.', 404);

  if (post.platform === 'tiktok' && post.status === 'processing' && post.externalId) {
    const account = await accountById(post.socialAccountId);
    if (account) {
      try {
        const s = await tiktokStatus(await accessTokenFor(account), post.externalId);
        if (s.status === 'PUBLISH_COMPLETE' || s.status === 'SEND_TO_USER_INBOX') {
          await updatePost(post.id, { status: 'posted', postedAt: new Date() });
        } else if (s.status === 'FAILED') {
          await updatePost(post.id, { status: 'failed', error: `TikTok could not publish it (${s.failReason ?? 'unknown reason'}).` });
        }
        post = (await getPost(userId, post.id)) ?? post;
      } catch {
        // Report the last known state.
      }
    }
  }
  return NextResponse.json({ id: post.id, status: post.status, url: post.url, error: post.error });
}

/**
 * DELETE: cancel a TikTok post that is still waiting, and delete its stored
 * clip. YouTube holds scheduled videos itself, so those are managed in
 * YouTube Studio.
 */
export async function DELETE(request: Request, { params }: Ctx) {
  const userId = await userIdFrom(request);
  if (!userId) return jsonError('Sign in first.', 401);
  const post = await getPost(userId, (await params).id);
  if (!post) return jsonError('No such post.', 404);
  if (post.platform !== 'tiktok' || post.status !== 'scheduled') {
    return jsonError(post.platform === 'youtube' ? 'Scheduled YouTube videos are managed in YouTube Studio.' : 'That post can no longer be canceled.', 409);
  }
  await updatePost(post.id, { status: 'canceled', blobPathname: null });
  if (post.blobPathname) await del(post.blobPathname).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
