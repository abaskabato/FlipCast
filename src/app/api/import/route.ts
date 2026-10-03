import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { fetchPiece, ImportError, MAX_CHUNK } from '@/lib/import/remote';
import { BROWSER_MAX_INPUT_BYTES } from '@/lib/quotas';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * GET /api/import?url=<link>&start=<byte>
 *
 * One piece (at most 4 MB) of a public video file, passed straight through
 * for hosts that do not allow the browser to fetch them directly. Nothing is
 * stored. Signed-in users only, so it cannot serve as an open proxy.
 *
 * The response carries the file's total size and type in headers, so the
 * browser can plan the remaining pieces after the first one.
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Sign in to import from a link.' }, { status: 401 });
  }
  // A 400 MB file is 100 pieces; this allows a few imports a minute, no more.
  if (!checkRateLimit(`import:${session.user.id}`, 240, 60_000)) {
    return NextResponse.json({ error: 'Too many imports at once. Try again in a minute.' }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url') ?? '';
  const start = Number(searchParams.get('start') ?? '0');
  if (start >= BROWSER_MAX_INPUT_BYTES) {
    return NextResponse.json({ error: 'That file is too large to render in the browser.' }, { status: 413 });
  }

  try {
    const piece = await fetchPiece(url, start);
    if (piece.total !== null && piece.total > BROWSER_MAX_INPUT_BYTES) {
      return NextResponse.json({ error: 'That file is too large to render in the browser.' }, { status: 413 });
    }
    return new NextResponse(new Uint8Array(piece.body), {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Import-Start': String(piece.start),
        'X-Import-Total': piece.total === null ? '' : String(piece.total),
        'X-Import-Type': piece.contentType,
        'X-Import-Chunk': String(MAX_CHUNK),
      },
    });
  } catch (e) {
    const err = e instanceof ImportError ? e : new ImportError('Could not import that link.', 502);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
