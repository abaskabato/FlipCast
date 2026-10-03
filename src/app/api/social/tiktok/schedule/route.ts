import { NextResponse } from 'next/server';
import { del, head } from '@vercel/blob';
import { z } from 'zod';

import { socialConfig } from '@/lib/social/config';
import { jsonError, platformErrorResponse, userIdFrom } from '@/lib/social/http';
import { accessTokenFor, createPost, getAccount } from '@/lib/social/store';
import { tiktokCreatorInfo } from '@/lib/social/tiktok';
import { optionsOf, TikTokPostBody } from '@/lib/social/tiktok-body';

export const runtime = 'nodejs';

const Body = TikTokPostBody.extend({
  blobPathname: z.string().min(1),
  scheduledAt: z.string().datetime(),
});

/**
 * POST: schedule a TikTok post for a clip the browser already put in private
 * Blob storage. Our scheduler sends it when the time comes.
 */
export async function POST(request: Request) {
  if (!socialConfig().tiktokScheduling) return jsonError('Scheduling TikTok posts is not set up.', 503);
  const userId = await userIdFrom(request);
  if (!userId) return jsonError('Sign in first.', 401);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('Choose who can see the post and when to post it.', 400);
  const b = parsed.data;
  const discard = () => del(b.blobPathname).catch(() => undefined);

  if (!b.blobPathname.startsWith(`scheduled/${userId}/`)) return jsonError('Not your upload.', 403);
  const when = new Date(b.scheduledAt);
  if (when.getTime() < Date.now() + 5 * 60_000 || when.getTime() > Date.now() + 60 * 86_400_000) {
    await discard();
    return jsonError('Pick a time between 5 minutes and 60 days from now.', 400);
  }
  const account = await getAccount(userId, b.accountId);
  if (!account || account.platform !== 'tiktok') {
    await discard();
    return jsonError('Connect a TikTok account first.', 404);
  }
  const stored = await head(b.blobPathname).catch(() => null);
  if (!stored) return jsonError('The clip did not finish uploading. Try again.', 409);

  try {
    // Check the settings now, so a bad choice fails here and not at post time.
    const creator = await tiktokCreatorInfo(await accessTokenFor(account));
    if (!creator.privacy_level_options.includes(b.privacy)) {
      await discard();
      return jsonError('That privacy setting is not available for this TikTok account.', 422);
    }
    if (b.durationSec > creator.max_video_post_duration_sec) {
      await discard();
      return jsonError(`This account can post videos up to ${Math.floor(creator.max_video_post_duration_sec)} seconds.`, 422);
    }
    const post = await createPost({
      userId,
      socialAccountId: account.id,
      platform: 'tiktok',
      status: 'scheduled',
      scheduledAt: when,
      title: b.title,
      privacy: b.privacy,
      options: optionsOf(b),
      sizeBytes: stored.size,
      blobPathname: b.blobPathname,
    });
    return NextResponse.json({ postId: post.id });
  } catch (e) {
    await discard();
    return platformErrorResponse(e, 'Could not schedule the TikTok post.');
  }
}
