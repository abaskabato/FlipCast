import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * Retired: server-side upload fallback.
 *
 * Rendering is local, so there is no reason to push a 500MB file through a
 * serverless function (which caps request bodies at ~4.5MB anyway).
 * Explicit 410 so stale clients fail loudly.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(
    {
      error: 'Uploads are no longer used: Flipcast renders locally in your browser.',
      migration: 'Drop this step and call renderToRatios() from src/lib/video/ffmpeg-client.ts.',
    },
    { status: 410 },
  );
}