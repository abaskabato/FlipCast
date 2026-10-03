'use client';

/**
 * Browser side of publishing. The rendered clip goes straight from this tab to
 * YouTube or TikTok; our server only opens the upload with the user's token.
 * The one exception is a TikTok post scheduled for later, which waits in
 * private storage because TikTok's API cannot schedule.
 */

import { upload } from '@vercel/blob/client';

export type SocialConfig = { youtube: boolean; tiktok: boolean; tiktokScheduling: boolean };
export type Platform = 'youtube' | 'tiktok';
export type Account = { id: string; platform: Platform; displayName: string; avatarUrl: string | null; createdAt: string };
export type CreatorInfo = {
  nickname: string;
  username: string;
  privacyOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxDurationSec: number;
};
export type Post = {
  id: string;
  platform: Platform;
  accountName: string;
  status: string;
  title: string;
  privacy: string;
  scheduledAt: string | null;
  postedAt: string | null;
  url: string | null;
  error: string | null;
  createdAt: string;
};

export class PublishError extends Error {
  readonly reconnect: boolean;
  constructor(message: string, reconnect = false) {
    super(message);
    this.name = 'PublishError';
    this.reconnect = reconnect;
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new PublishError(body.error ?? 'Something went wrong. Try again.', Boolean(body.reconnect));
  return body as T;
}
const post = <T>(url: string, body: unknown) =>
  api<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const getSocialConfig = () => api<SocialConfig>('/api/social/config');
export const listAccounts = () => api<{ accounts: Account[] }>('/api/social/accounts').then((r) => r.accounts);
export const disconnectAccount = (id: string) => api(`/api/social/accounts?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
export const listPosts = () => api<{ posts: Post[] }>('/api/social/posts').then((r) => r.posts);
export const cancelPost = (id: string) => api(`/api/social/posts/${id}`, { method: 'DELETE' });
export const tiktokCreator = (accountId: string) => api<CreatorInfo>(`/api/social/tiktok/creator?accountId=${encodeURIComponent(accountId)}`);

/**
 * Connect an account in a popup, so the clips rendered in this tab survive.
 * Resolves with the new account once it appears, or null if the popup is
 * closed first or it takes too long.
 */
export async function connectInPopup(platform: Platform): Promise<Account | null> {
  const before = new Set((await listAccounts().catch(() => [])).map((a) => a.id));
  const popup = window.open(`/api/social/${platform}/connect`, `connect-${platform}`, 'width=520,height=720');
  if (!popup) {
    throw new PublishError('Your browser blocked the sign-in window. Allow pop-ups for this site, or connect from your Account page.');
  }
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const found = (await listAccounts().catch(() => [])).find((a) => a.platform === platform && !before.has(a.id));
    if (found) {
      try {
        popup.close();
      } catch {
        /* cross-origin-isolated pages may not reach it */
      }
      return found;
    }
    // A closed popup with no new account means the user gave up.
    let closed = false;
    try {
      closed = popup.closed;
    } catch {
      closed = false;
    }
    if (closed) return (await listAccounts().catch(() => [])).find((a) => a.platform === platform && !before.has(a.id)) ?? null;
  }
  return null;
}

/** PUT with upload progress (fetch cannot report upload progress). */
function putWithProgress(url: string, body: Blob, headers: Record<string, string>, onProgress: (sent: number) => void): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
    xhr.onerror = () => reject(new PublishError('The upload was interrupted. Check your connection and try again.'));
    xhr.send(body);
  });
}

const report = (postId: string, body: unknown) =>
  api(`/api/social/posts/${postId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => undefined);

export type YouTubeForm = {
  accountId: string;
  title: string;
  description: string;
  privacy: 'public' | 'unlisted' | 'private';
  publishAt: string | null;
};

/** Upload to YouTube; resolves with the video's link. */
export async function publishToYouTube(clip: Blob, form: YouTubeForm, onProgress: (fraction: number) => void): Promise<string> {
  const { postId, uploadUrl } = await post<{ postId: string; uploadUrl: string }>('/api/social/youtube/upload', {
    ...form,
    sizeBytes: clip.size,
    contentType: clip.type || 'video/mp4',
  });
  try {
    const res = await putWithProgress(uploadUrl, clip, { 'Content-Type': clip.type || 'video/mp4' }, (sent) => onProgress(sent / clip.size));
    const video = JSON.parse(res.text || '{}');
    if (res.status >= 300 || !video.id) throw new PublishError(video.error?.message ?? 'YouTube did not accept the upload.');
    await report(postId, { result: 'uploaded', videoId: video.id });
    return `https://youtu.be/${video.id}`;
  } catch (e) {
    await report(postId, { result: 'failed', error: e instanceof Error ? e.message.slice(0, 400) : 'Upload failed' });
    throw e;
  }
}

export type TikTokForm = {
  accountId: string;
  title: string;
  privacy: string;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  brandContent: boolean;
  brandOrganic: boolean;
  durationSec: number;
};

/**
 * Post to TikTok now: chunks go straight to TikTok, then we wait (briefly) for
 * TikTok to finish processing. Resolves with the post's final status.
 */
export async function publishToTikTokNow(clip: Blob, form: TikTokForm, onProgress: (fraction: number) => void): Promise<string> {
  const { postId, uploadUrl, ranges } = await post<{ postId: string; uploadUrl: string; ranges: [number, number][] }>(
    '/api/social/tiktok/init',
    { ...form, sizeBytes: clip.size },
  );
  try {
    let done = 0;
    for (const [start, end] of ranges) {
      const res = await putWithProgress(
        uploadUrl,
        clip.slice(start, end + 1),
        { 'Content-Type': clip.type || 'video/mp4', 'Content-Range': `bytes ${start}-${end}/${clip.size}` },
        (sent) => onProgress((done + sent) / clip.size),
      );
      if (res.status >= 300 && res.status !== 308) throw new PublishError(`TikTok rejected part of the upload (${res.status}).`);
      done += end - start + 1;
    }
    await report(postId, { result: 'uploaded' });
  } catch (e) {
    await report(postId, { result: 'failed', error: e instanceof Error ? e.message.slice(0, 400) : 'Upload failed' });
    throw e;
  }
  // TikTok usually finishes within a minute; after that the Account page shows it.
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const s = await api<{ status: string; error: string | null }>(`/api/social/posts/${postId}`).catch(() => null);
    if (s?.status === 'posted') return 'posted';
    if (s?.status === 'failed') throw new PublishError(s.error ?? 'TikTok could not publish it.');
  }
  return 'processing';
}

/** Schedule a TikTok post: the clip waits in private storage until its time. */
export async function scheduleTikTok(
  clip: Blob,
  filename: string,
  userId: string,
  form: TikTokForm & { scheduledAt: string },
  onProgress: (fraction: number) => void,
): Promise<void> {
  const stored = await upload(`scheduled/${userId}/${filename.replace(/[^\w.-]+/g, '_')}`, clip, {
    access: 'private',
    handleUploadUrl: '/api/social/tiktok/blob',
    contentType: clip.type || 'video/mp4',
    multipart: clip.size > 8 * 1024 * 1024,
    onUploadProgress: ({ percentage }) => onProgress(percentage / 100),
  });
  await post('/api/social/tiktok/schedule', { ...form, sizeBytes: clip.size, blobPathname: stored.pathname });
}

/** TikTok's privacy values, as TikTok's own app words them. */
export const TIKTOK_PRIVACY_LABELS: Record<string, string> = {
  PUBLIC_TO_EVERYONE: 'Everyone',
  MUTUAL_FOLLOW_FRIENDS: 'Friends',
  FOLLOWER_OF_CREATOR: 'Followers',
  SELF_ONLY: 'Only me',
};
