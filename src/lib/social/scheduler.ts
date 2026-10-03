/**
 * The TikTok scheduler: run by /api/social/cron every few minutes.
 *
 * 1. Claims TikTok posts whose time has come and sends each one: a fresh
 *    token, TikTok's creator check, then the clip streamed from private Blob
 *    storage to TikTok in chunks (so memory stays at one chunk).
 * 2. Checks posts TikTok is still processing, and records the outcome.
 *
 * The clip is deleted from storage once TikTok has finished with it, either
 * way, or when the post is canceled.
 *
 * Storage is passed in, so tests can run this without Vercel Blob.
 *
 * Node only.
 */

import { accessTokenFor, accountById, claimDuePosts, processingPosts, updatePost, type PostRow } from './store';
import { tiktokInitUpload, tiktokPutChunk, tiktokStatus, type TikTokPostOptions } from './tiktok';
import { PlatformError } from './youtube';

export type ClipStore = {
  /** The stored clip as a stream, with its size and type. */
  open(pathname: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number; contentType: string } | null>;
  remove(pathname: string): Promise<void>;
};

/** Give up on a post after this many failed sends. */
const MAX_ATTEMPTS = 3;

export type SchedulerReport = { sent: string[]; retried: string[]; failed: string[]; posted: string[] };

/** Stream `source` to TikTok, cutting it exactly at the planned chunk boundaries. */
async function streamToTikTok(
  source: ReadableStream<Uint8Array>,
  uploadUrl: string,
  ranges: [number, number][],
  size: number,
  contentType: string,
) {
  const reader = source.getReader();
  let buffer = new Uint8Array(0);
  for (const [start, end] of ranges) {
    const need = end - start + 1;
    while (buffer.length < need) {
      const { done, value } = await reader.read();
      if (done) throw new PlatformError('The stored clip was shorter than expected.', 500);
      const next = new Uint8Array(buffer.length + value.length);
      next.set(buffer);
      next.set(value, buffer.length);
      buffer = next;
    }
    await tiktokPutChunk(uploadUrl, buffer.subarray(0, need), [start, end], size, contentType);
    buffer = buffer.slice(need);
  }
  reader.releaseLock();
}

async function sendOne(post: PostRow, store: ClipStore): Promise<void> {
  const account = await accountById(post.socialAccountId);
  if (!account) throw new PlatformError('The TikTok account was disconnected.', 410, true);
  if (!post.blobPathname) throw new PlatformError('The clip for this post is missing.', 410, true);
  const clip = await store.open(post.blobPathname);
  if (!clip) throw new PlatformError('The clip for this post is missing.', 410, true);

  const token = await accessTokenFor(account);
  const options = JSON.parse(post.options ?? '{}') as TikTokPostOptions;
  const { publishId, uploadUrl, plan } = await tiktokInitUpload(token, { ...options, title: post.title, privacy: post.privacy }, clip.size);
  await updatePost(post.id, { externalId: publishId });
  await streamToTikTok(clip.stream, uploadUrl, plan.ranges, clip.size, clip.contentType || 'video/mp4');
  await updatePost(post.id, { status: 'processing', error: null });
}

export async function runScheduler(store: ClipStore, now = new Date()): Promise<SchedulerReport> {
  const report: SchedulerReport = { sent: [], retried: [], failed: [], posted: [] };

  for (const post of await claimDuePosts(now)) {
    try {
      await sendOne(post, store);
      report.sent.push(post.id);
    } catch (e) {
      const err = e instanceof PlatformError ? e : new PlatformError('Sending to TikTok failed.', 502);
      const attempts = post.attempts + 1;
      const final = err.reconnect || err.status === 422 || attempts >= MAX_ATTEMPTS;
      await updatePost(post.id, { status: final ? 'failed' : 'scheduled', attempts, error: err.message });
      if (final) {
        if (post.blobPathname) await store.remove(post.blobPathname).catch(() => undefined);
        report.failed.push(post.id);
      } else {
        report.retried.push(post.id);
      }
    }
  }

  for (const post of await processingPosts()) {
    try {
      const account = await accountById(post.socialAccountId);
      if (!account || !post.externalId) continue;
      const s = await tiktokStatus(await accessTokenFor(account), post.externalId);
      if (s.status === 'PUBLISH_COMPLETE' || s.status === 'SEND_TO_USER_INBOX') {
        await updatePost(post.id, { status: 'posted', postedAt: new Date(), error: null });
        report.posted.push(post.id);
      } else if (s.status === 'FAILED') {
        await updatePost(post.id, { status: 'failed', error: `TikTok could not publish it (${s.failReason ?? 'unknown reason'}).` });
        report.failed.push(post.id);
      } else {
        continue; // still processing
      }
      if (post.blobPathname) await store.remove(post.blobPathname).catch(() => undefined);
    } catch {
      // Try again on the next run.
    }
  }
  return report;
}
