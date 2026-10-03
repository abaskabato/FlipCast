import { NextResponse } from 'next/server';

import { siteOrigin, socialConfig } from '@/lib/social/config';
import { createState } from '@/lib/social/crypto';
import { userIdFrom } from '@/lib/social/http';
import { tiktokAuthUrl } from '@/lib/social/tiktok';
import { youtubeAuthUrl } from '@/lib/social/youtube';

export const runtime = 'nodejs';

/** GET: start connecting a YouTube channel or TikTok account (redirects to the platform). */
export async function GET(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const back = (q: string) => NextResponse.redirect(`${siteOrigin()}/account?${q}#connections`);
  if (platform !== 'youtube' && platform !== 'tiktok') return back('social_error=Unknown+platform');
  if (!socialConfig()[platform]) return back(`social_error=${encodeURIComponent(`${platform === 'youtube' ? 'YouTube' : 'TikTok'} publishing is not set up yet.`)}`);

  const userId = await userIdFrom(request);
  if (!userId) return NextResponse.redirect(`${siteOrigin()}/#account`);

  const { state, nonce } = createState(userId, platform);
  const res = NextResponse.redirect(platform === 'youtube' ? youtubeAuthUrl(state) : tiktokAuthUrl(state));
  // Binds the callback to this browser: the state alone is not enough.
  res.cookies.set(`fc_oauth_${platform}`, nonce, {
    httpOnly: true,
    secure: siteOrigin().startsWith('https://'),
    sameSite: 'lax',
    path: `/api/social/${platform}/callback`,
    maxAge: 600,
  });
  return res;
}
