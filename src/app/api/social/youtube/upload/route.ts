import { NextResponse } from 'next/server';
import { z } from 'zod';

import { siteOrigin, socialConfig } from '@/lib/social/config';
import { jsonError, platformErrorResponse, userIdFrom } from '@/lib/social/http';
import { accessTokenFor, createPost, getAccount } from '@/lib/social/store';
import { youtubeUploadSession } from '@/lib/social/youtube';
import { BROWSER_MAX_INPUT_BYTES } from '@/lib/quotas';

export const runtime = 'nodejs';

const Body = z.object({
  accountId: z.string(),
  title: z.string().trim().min(1).max(100),
  description: z.string().max(5000).default(''),
  privacy: z.enum(['public', 'unlisted', 'private']),
  /** ISO time at least a few minutes ahead, or null to publish on upload. */
  publishAt: z.string().datetime().nullable(),
  sizeBytes: z.number().int().positive().max(BROWSER_MAX_INPUT_BYTES),
  contentType: z.string().regex(/^video\//).default('video/mp4'),
});

/**
 * POST: open a YouTube upload session. The browser then PUTs the clip to the
 * returned URL directly; it never passes through our servers.
 */
export async function POST(request: Request) {
  if (!socialConfig().youtube) return jsonError('YouTube publishing is not set up.', 503);
  const userId = await userIdFrom(request);
  if (!userId) return jsonError('Sign in first.', 401);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('Check the title and schedule.', 400);
  const b = parsed.data;
  if (b.publishAt && new Date(b.publishAt).getTime() < Date.now() + 2 * 60_000) {
    return jsonError('Pick a time at least a few minutes from now.', 400);
  }
  const account = await getAccount(userId, b.accountId);
  if (!account || account.platform !== 'youtube') return jsonError('Connect a YouTube channel first.', 404);

  try {
    const uploadUrl = await youtubeUploadSession(await accessTokenFor(account), b, request.headers.get('origin') || siteOrigin());
    const post = await createPost({
      userId,
      socialAccountId: account.id,
      platform: 'youtube',
      status: 'uploading',
      scheduledAt: b.publishAt ? new Date(b.publishAt) : null,
      title: b.title,
      description: b.description,
      privacy: b.publishAt ? 'private' : b.privacy,
      sizeBytes: b.sizeBytes,
    });
    return NextResponse.json({ postId: post.id, uploadUrl });
  } catch (e) {
    return platformErrorResponse(e, 'Could not start the YouTube upload.');
  }
}
