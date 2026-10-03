import { NextResponse } from 'next/server';

import { siteOrigin } from '@/lib/social/config';
import { verifyState } from '@/lib/social/crypto';
import { userIdFrom } from '@/lib/social/http';
import { saveAccount } from '@/lib/social/store';
import { tiktokExchangeCode, tiktokUser } from '@/lib/social/tiktok';
import { PlatformError, youtubeChannel, youtubeExchangeCode } from '@/lib/social/youtube';

export const runtime = 'nodejs';

/** GET: the platform sends the user back here after they approve (or decline). */
export async function GET(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const back = (q: string) => {
    const res = NextResponse.redirect(`${siteOrigin()}/account?${q}#connections`);
    res.cookies.delete({ name: `fc_oauth_${platform}`, path: `/api/social/${platform}/callback` });
    return res;
  };
  const fail = (message: string) => back(`social_error=${encodeURIComponent(message)}`);
  if (platform !== 'youtube' && platform !== 'tiktok') return fail('Unknown platform.');

  const url = new URL(request.url);
  if (url.searchParams.get('error')) return fail('Connection was cancelled.');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const userId = await userIdFrom(request);
  if (!userId) return NextResponse.redirect(`${siteOrigin()}/#account`);
  const nonce = request.headers.get('cookie')?.match(new RegExp(`(?:^|; )fc_oauth_${platform}=([^;]+)`))?.[1];
  if (!code || !state || !verifyState(state, { nonce, userId, platform })) {
    return fail('That connection link expired or did not come from this browser. Try again.');
  }

  try {
    if (platform === 'youtube') {
      const tokens = await youtubeExchangeCode(code);
      const ch = await youtubeChannel(tokens.accessToken);
      await saveAccount({ userId, platform, externalId: ch.id, displayName: ch.title, avatarUrl: ch.avatarUrl, tokens });
    } else {
      const tokens = await tiktokExchangeCode(code);
      if (!tokens.scope?.includes('video.publish')) return fail('TikTok did not grant permission to post. Allow it and try again.');
      const u = await tiktokUser(tokens.accessToken);
      await saveAccount({ userId, platform, externalId: tokens.openId || u.openId, displayName: u.displayName, avatarUrl: u.avatarUrl, tokens });
    }
    return back(`connected=${platform}`);
  } catch (e) {
    console.error('[social] connect failed', e);
    return fail(e instanceof PlatformError ? e.message : 'Could not connect the account. Try again.');
  }
}
