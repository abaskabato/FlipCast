import { NextResponse } from 'next/server';

import { socialConfig } from '@/lib/social/config';
import { jsonError, platformErrorResponse, userIdFrom } from '@/lib/social/http';
import { accessTokenFor, createPost, getAccount } from '@/lib/social/store';
import { tiktokCreatorInfo, tiktokInitUpload } from '@/lib/social/tiktok';
import { optionsOf, TikTokPostBody } from '@/lib/social/tiktok-body';

export const runtime = 'nodejs';

/**
 * POST: start a TikTok post now. Returns TikTok's upload URL and the chunk
 * ranges; the browser uploads the clip there directly.
 */
export async function POST(request: Request) {
  if (!socialConfig().tiktok) return jsonError('TikTok publishing is not set up.', 503);
  const userId = await userIdFrom(request);
  if (!userId) return jsonError('Sign in first.', 401);
  const parsed = TikTokPostBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('Choose who can see the post.', 400);
  const b = parsed.data;
  const account = await getAccount(userId, b.accountId);
  if (!account || account.platform !== 'tiktok') return jsonError('Connect a TikTok account first.', 404);

  try {
    const token = await accessTokenFor(account);
    const creator = await tiktokCreatorInfo(token);
    if (b.durationSec > creator.max_video_post_duration_sec) {
      return jsonError(`This account can post videos up to ${Math.floor(creator.max_video_post_duration_sec)} seconds.`, 422);
    }
    const { publishId, uploadUrl, plan } = await tiktokInitUpload(token, b, b.sizeBytes);
    const post = await createPost({
      userId,
      socialAccountId: account.id,
      platform: 'tiktok',
      status: 'uploading',
      title: b.title,
      privacy: b.privacy,
      options: optionsOf(b),
      sizeBytes: b.sizeBytes,
      externalId: publishId,
    });
    return NextResponse.json({ postId: post.id, uploadUrl, ranges: plan.ranges });
  } catch (e) {
    return platformErrorResponse(e, 'Could not start the TikTok post.');
  }
}
