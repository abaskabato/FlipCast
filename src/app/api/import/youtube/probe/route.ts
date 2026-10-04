import { NextResponse } from 'next/server';

import { lookUpVideo, YouTubeImportError, youtubeId } from '@/lib/import/youtube';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/import/youtube/probe?url=<youtube link>
 *
 * Diagnostics: can this deployment reach YouTube through yt-dlp? Only on
 * preview deployments (behind Vercel's deployment protection) and local
 * runs; production answers 404.
 */
export async function GET(request: Request) {
  if (process.env.VERCEL_ENV === 'production') return new NextResponse(null, { status: 404 });
  const params = new URL(request.url).searchParams;
  const id = youtubeId(params.get('url') ?? '');
  // Which YouTube client yt-dlp imitates, to compare how often each is blocked.
  const client = /^[a-z_,]{1,60}$/.test(params.get('client') ?? '') ? params.get('client')! : undefined;
  if (!id) return NextResponse.json({ error: 'Not a YouTube link.' }, { status: 400 });
  const started = Date.now();
  try {
    const video = await lookUpVideo(id, { playerClient: client });
    return NextResponse.json({ ok: true, ms: Date.now() - started, video });
  } catch (e) {
    const err = e instanceof YouTubeImportError ? e : new YouTubeImportError(String(e));
    return NextResponse.json({ ok: false, ms: Date.now() - started, error: err.message }, { status: err.status });
  }
}
