/**
 * YouTube: OAuth, channel lookup, and resumable upload sessions.
 *
 * The video itself never passes through our servers: the server opens a
 * resumable upload session with the user's token (so the token never reaches
 * the browser) and hands the session URL to the browser, which PUTs the file
 * straight to YouTube. Scheduling is native: a private video with `publishAt`
 * goes public at that time without anything running on our side.
 *
 * Node only.
 */

import { endpoints, redirectUri } from './config';

export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  // Read-only, to show which channel is connected.
  'https://www.googleapis.com/auth/youtube.readonly',
];

export type Tokens = { accessToken: string; refreshToken: string | null; expiresAt: Date; scope: string | null };

export class PlatformError extends Error {
  readonly status: number;
  readonly reconnect: boolean;
  constructor(message: string, status = 502, reconnect = false) {
    super(message);
    this.name = 'PlatformError';
    this.status = status;
    this.reconnect = reconnect;
  }
}

const clientId = () => process.env.YOUTUBE_CLIENT_ID!.trim();
const clientSecret = () => process.env.YOUTUBE_CLIENT_SECRET!.trim();

export function youtubeAuthUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri('youtube'),
    response_type: 'code',
    scope: YOUTUBE_SCOPES.join(' '),
    // A refresh token, so scheduled and later posts work without the user.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${endpoints.googleAuth()}/o/oauth2/v2/auth?${q}`;
}

async function tokenRequest(params: Record<string, string>): Promise<Tokens> {
  const res = await fetch(`${endpoints.googleToken()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), ...params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    // invalid_grant: the refresh token was revoked or expired.
    const reconnect = body.error === 'invalid_grant';
    throw new PlatformError(reconnect ? 'YouTube access was revoked. Reconnect the channel.' : 'Google did not issue a token.', reconnect ? 401 : 502, reconnect);
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (Number(body.expires_in) || 3600) * 1000),
    scope: body.scope ?? null,
  };
}

export const youtubeExchangeCode = (code: string) =>
  tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirectUri('youtube') });

export const youtubeRefresh = (refreshToken: string) =>
  tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' });

export async function youtubeRevoke(token: string): Promise<void> {
  await fetch(`${endpoints.googleToken()}/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => undefined);
}

export async function youtubeChannel(accessToken: string): Promise<{ id: string; title: string; avatarUrl: string | null }> {
  const res = await fetch(`${endpoints.youtube()}/youtube/v3/channels?part=snippet&mine=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await res.json().catch(() => ({}));
  const ch = body.items?.[0];
  if (!res.ok || !ch) throw new PlatformError('That Google account has no YouTube channel. Create one, then connect again.', 422);
  return { id: ch.id, title: ch.snippet?.title ?? 'YouTube channel', avatarUrl: ch.snippet?.thumbnails?.default?.url ?? null };
}

export type YouTubeVideoMeta = {
  title: string;
  description: string;
  privacy: 'public' | 'unlisted' | 'private';
  /** ISO time; the video stays private until then. */
  publishAt: string | null;
  sizeBytes: number;
  contentType: string;
};

/** Fields YouTube accepts, built from what the user chose. Pure; tested. */
export function youtubeVideoResource(meta: YouTubeVideoMeta) {
  return {
    snippet: {
      title: meta.title.slice(0, 100),
      description: meta.description.slice(0, 5000),
      // People & Blogs; vertical videos under three minutes become Shorts.
      categoryId: '22',
    },
    status: meta.publishAt
      ? // A scheduled video must be private until it publishes.
        { privacyStatus: 'private', publishAt: meta.publishAt, selfDeclaredMadeForKids: false }
      : { privacyStatus: meta.privacy, selfDeclaredMadeForKids: false },
  };
}

/**
 * Open a resumable upload session; the returned URL accepts the file with a
 * plain PUT and needs no token. `origin` lets the browser at that origin use
 * the session (cross-origin upload).
 */
export async function youtubeUploadSession(accessToken: string, meta: YouTubeVideoMeta, origin: string): Promise<string> {
  const res = await fetch(`${endpoints.youtube()}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(meta.sizeBytes),
      'X-Upload-Content-Type': meta.contentType,
      Origin: origin,
    },
    body: JSON.stringify(youtubeVideoResource(meta)),
  });
  const location = res.headers.get('location');
  if (!res.ok || !location) {
    const body = await res.json().catch(() => ({}));
    const reason = body.error?.errors?.[0]?.reason as string | undefined;
    if (res.status === 401) throw new PlatformError('YouTube access expired. Reconnect the channel.', 401, true);
    if (reason === 'quotaExceeded' || reason === 'uploadLimitExceeded') {
      throw new PlatformError('YouTube upload limit reached for today. Try again tomorrow.', 429);
    }
    throw new PlatformError(body.error?.message ?? 'YouTube refused the upload.', 502);
  }
  return location;
}
