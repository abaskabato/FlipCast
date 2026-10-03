/**
 * TikTok: OAuth, creator info, and the Content Posting API (Direct Post).
 *
 * Posting now: the server initialises the post with the user's token and gets
 * an upload URL; the browser PUTs the file to it in chunks, so the video never
 * passes through our servers. TikTok's API cannot schedule, so posts for later
 * are sent by our scheduler (/api/social/cron) from private Blob storage.
 *
 * Until TikTok audits the app, every post it makes is private to the creator
 * (`unaudited_client_can_only_post_to_private_accounts`).
 *
 * Node only (the chunk plan is pure and shared with the browser).
 */

import { endpoints, redirectUri } from './config';
import { PlatformError, type Tokens } from './youtube';

export const TIKTOK_SCOPES = ['user.info.basic', 'video.publish'];

const clientKey = () => process.env.TIKTOK_CLIENT_KEY!.trim();
const clientSecret = () => process.env.TIKTOK_CLIENT_SECRET!.trim();

const MB = 1024 * 1024;
/** TikTok: chunks of 5-64 MB, the last up to 128 MB; under 5 MB goes whole. */
export const MIN_CHUNK = 5 * MB;
const CHUNK = 10 * MB;

export type ChunkPlan = { chunkSize: number; totalChunks: number; ranges: [number, number][] };

/**
 * How to cut `size` bytes for TikTok. total_chunk_count is size / chunk_size
 * rounded down, so the remainder rides on the last chunk. Pure; tested.
 */
export function chunkPlan(size: number): ChunkPlan {
  if (!(size > 0)) throw new Error('Empty video.');
  // Under one chunk's worth, send it whole: total_chunk_count must be at
  // least 1, and size / chunk_size rounded down would be 0. (Under 5 MB
  // TikTok requires this anyway.)
  if (size < CHUNK) return { chunkSize: size, totalChunks: 1, ranges: [[0, size - 1]] };
  const chunkSize = CHUNK;
  const totalChunks = Math.max(1, Math.floor(size / chunkSize));
  const ranges: [number, number][] = [];
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = i === totalChunks - 1 ? size - 1 : start + chunkSize - 1;
    ranges.push([start, end]);
  }
  return { chunkSize, totalChunks, ranges };
}

export function tiktokAuthUrl(state: string): string {
  const q = new URLSearchParams({
    client_key: clientKey(),
    scope: TIKTOK_SCOPES.join(','),
    response_type: 'code',
    redirect_uri: redirectUri('tiktok'),
    state,
  });
  return `${endpoints.tiktokAuth()}/v2/auth/authorize/?${q}`;
}

async function tokenRequest(params: Record<string, string>): Promise<Tokens & { openId: string }> {
  const res = await fetch(`${endpoints.tiktok()}/v2/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: clientKey(), client_secret: clientSecret(), ...params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const reconnect = params.grant_type === 'refresh_token';
    throw new PlatformError(reconnect ? 'TikTok access expired. Reconnect the account.' : 'TikTok did not issue a token.', reconnect ? 401 : 502, reconnect);
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (Number(body.expires_in) || 86400) * 1000),
    scope: body.scope ?? null,
    openId: body.open_id,
  };
}

export const tiktokExchangeCode = (code: string) =>
  tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirectUri('tiktok') });

export const tiktokRefresh = (refreshToken: string) =>
  tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' });

export async function tiktokRevoke(token: string): Promise<void> {
  await fetch(`${endpoints.tiktok()}/v2/oauth/revoke/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: clientKey(), client_secret: clientSecret(), token }),
  }).catch(() => undefined);
}

/** TikTok wraps every answer as { data, error: { code, message } }; code "ok" is success. */
async function api<T>(accessToken: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${endpoints.tiktok()}${path}`, {
    method: init.method ?? 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = await res.json().catch(() => ({}));
  const code = body.error?.code;
  if (!res.ok || (code && code !== 'ok')) {
    if (res.status === 401 || code === 'access_token_invalid') throw new PlatformError('TikTok access expired. Reconnect the account.', 401, true);
    if (code === 'spam_risk_too_many_posts' || code === 'rate_limit_exceeded') {
      throw new PlatformError('TikTok is limiting posts from this account right now. Try again later.', 429);
    }
    if (code === 'unaudited_client_can_only_post_to_private_accounts') {
      throw new PlatformError('Until Flipcast is approved by TikTok, posts must be private ("Only me").', 422);
    }
    throw new PlatformError(body.error?.message || `TikTok refused the request (${code ?? res.status}).`, 502);
  }
  return body.data as T;
}

export async function tiktokUser(accessToken: string): Promise<{ openId: string; displayName: string; avatarUrl: string | null }> {
  const d = await api<{ user: { open_id: string; display_name?: string; avatar_url?: string } }>(
    accessToken,
    '/v2/user/info/?fields=open_id,display_name,avatar_url',
    { method: 'GET' },
  );
  return { openId: d.user.open_id, displayName: d.user.display_name || 'TikTok account', avatarUrl: d.user.avatar_url ?? null };
}

export type CreatorInfo = {
  creator_nickname: string;
  creator_username: string;
  creator_avatar_url: string;
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
};

/** Required before every post: what this creator may post, and how. */
export const tiktokCreatorInfo = (accessToken: string) =>
  api<CreatorInfo>(accessToken, '/v2/post/publish/creator_info/query/', { body: {} });

export type TikTokPostOptions = {
  title: string;
  privacy: string;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  /** Promoting a third party (paid partnership). */
  brandContent: boolean;
  /** Promoting the creator's own business. */
  brandOrganic: boolean;
};

/** The post_info TikTok expects. Pure; tested. */
export function tiktokPostInfo(o: TikTokPostOptions) {
  return {
    title: o.title.slice(0, 2200),
    privacy_level: o.privacy,
    disable_comment: o.disableComment,
    disable_duet: o.disableDuet,
    disable_stitch: o.disableStitch,
    brand_content_toggle: o.brandContent,
    brand_organic_toggle: o.brandOrganic,
  };
}

/** Start a Direct Post with a file upload; returns where to PUT the chunks. */
export async function tiktokInitUpload(
  accessToken: string,
  options: TikTokPostOptions,
  sizeBytes: number,
): Promise<{ publishId: string; uploadUrl: string; plan: ChunkPlan }> {
  const creator = await tiktokCreatorInfo(accessToken);
  if (!creator.privacy_level_options.includes(options.privacy)) {
    throw new PlatformError('That privacy setting is not available for this TikTok account.', 422);
  }
  const plan = chunkPlan(sizeBytes);
  const d = await api<{ publish_id: string; upload_url: string }>(accessToken, '/v2/post/publish/video/init/', {
    body: {
      post_info: tiktokPostInfo({
        ...options,
        // Respect the creator's own account settings.
        disableComment: options.disableComment || creator.comment_disabled,
        disableDuet: options.disableDuet || creator.duet_disabled,
        disableStitch: options.disableStitch || creator.stitch_disabled,
      }),
      source_info: { source: 'FILE_UPLOAD', video_size: sizeBytes, chunk_size: plan.chunkSize, total_chunk_count: plan.totalChunks },
    },
  });
  return { publishId: d.publish_id, uploadUrl: d.upload_url, plan };
}

export type TikTokStatus = { status: string; failReason: string | null; postIds: string[] };

export async function tiktokStatus(accessToken: string, publishId: string): Promise<TikTokStatus> {
  const d = await api<{ status: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] }>(
    accessToken,
    '/v2/post/publish/status/fetch/',
    { body: { publish_id: publishId } },
  );
  return { status: d.status, failReason: d.fail_reason ?? null, postIds: (d.publicaly_available_post_id ?? []).map(String) };
}

/** PUT one chunk to TikTok's upload URL (server side, for scheduled posts). */
export async function tiktokPutChunk(uploadUrl: string, chunk: Uint8Array, range: [number, number], total: number, contentType: string) {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(chunk.byteLength),
      'Content-Range': `bytes ${range[0]}-${range[1]}/${total}`,
    },
    body: chunk as unknown as BodyInit,
  });
  if (!res.ok && res.status !== 206 && res.status !== 201) {
    throw new PlatformError(`TikTok rejected part of the upload (${res.status}).`, 502);
  }
}
