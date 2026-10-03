import { NextResponse } from 'next/server';

import { jsonError, platformErrorResponse, userIdFrom } from '@/lib/social/http';
import { accessTokenFor, getAccount } from '@/lib/social/store';
import { tiktokCreatorInfo } from '@/lib/social/tiktok';

export const runtime = 'nodejs';

/**
 * GET ?accountId=: what this creator may post, which TikTok requires apps to
 * show before posting (account name, privacy choices, interaction settings).
 */
export async function GET(request: Request) {
  const userId = await userIdFrom(request);
  if (!userId) return jsonError('Sign in first.', 401);
  const account = await getAccount(userId, new URL(request.url).searchParams.get('accountId') ?? '');
  if (!account || account.platform !== 'tiktok') return jsonError('Connect a TikTok account first.', 404);
  try {
    const c = await tiktokCreatorInfo(await accessTokenFor(account));
    return NextResponse.json({
      nickname: c.creator_nickname,
      username: c.creator_username,
      avatarUrl: c.creator_avatar_url,
      privacyOptions: c.privacy_level_options,
      commentDisabled: c.comment_disabled,
      duetDisabled: c.duet_disabled,
      stitchDisabled: c.stitch_disabled,
      maxDurationSec: c.max_video_post_duration_sec,
    });
  } catch (e) {
    return platformErrorResponse(e, 'Could not reach TikTok.');
  }
}
