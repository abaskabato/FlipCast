import { NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

import { socialConfig } from '@/lib/social/config';
import { userIdFrom } from '@/lib/social/http';
import { BROWSER_MAX_INPUT_BYTES } from '@/lib/quotas';

export const runtime = 'nodejs';

/**
 * POST: a short-lived token for the browser to put a rendered clip in private
 * Blob storage, for a TikTok post scheduled for later. Only the signed-in
 * user's own folder, only video, only up to the render size limit.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!socialConfig().tiktokScheduling) throw new Error('Scheduling TikTok posts is not set up.');
        const userId = await userIdFrom(request);
        if (!userId) throw new Error('Sign in first.');
        if (!pathname.startsWith(`scheduled/${userId}/`)) throw new Error('Not your folder.');
        return {
          allowedContentTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
          maximumSizeInBytes: BROWSER_MAX_INPUT_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId }),
        };
      },
      // The schedule route records the post; nothing to do when the upload lands.
      onUploadCompleted: async () => undefined,
    });
    return NextResponse.json(json);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
