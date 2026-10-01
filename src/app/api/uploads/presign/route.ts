import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * Retired: direct-to-storage uploads.
 *
 * Renders now happen in the browser, so source video is never uploaded and
 * there is no presigned PUT to hand out. Kept as an explicit 410 so any stale
 * client gets a clear signal instead of a confusing 500.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(
    {
      error: 'Uploads are no longer used: Flipcast renders locally in your browser.',
      migration: 'Drop the presign step and call renderToRatios() from src/lib/video/ffmpeg-client.ts.',
    },
    { status: 410 },
  );
}