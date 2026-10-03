import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { ClipFindError, findClips } from '@/lib/clips/find';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
// An hour of transcript takes the model a while to read and rank.
export const maxDuration = 120;

const Body = z.object({
  length: z.enum(['short', 'medium', 'long']),
  lines: z
    .array(
      z.object({
        i: z.number().int().min(0),
        start: z.number().min(0),
        end: z.number().min(0),
        text: z.string().max(400),
      }),
    )
    .min(3)
    .max(6000),
});

/**
 * POST /api/clips { length, lines } -> { clips }
 *
 * Suggests stand-alone short-form clips from a transcript made on the user's
 * device. Only the transcript text is sent here, never the video.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Sign in to find clips.' }, { status: 401 });
  }
  // Each call is a paid model request.
  if (!checkRateLimit(`clips:${session.user.id}`, 12, 60 * 60_000)) {
    return NextResponse.json({ error: 'You have found clips many times this hour. Try again later.' }, { status: 429 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'That transcript could not be read.' }, { status: 400 });
  }
  // Re-number defensively: the model refers to lines by position.
  const lines = parsed.data.lines.map((l, i) => ({ ...l, i }));

  try {
    const clips = await findClips(lines, parsed.data.length, {
      requestToken: request.headers.get('x-vercel-oidc-token'),
    });
    return NextResponse.json({ clips });
  } catch (e) {
    if (e instanceof ClipFindError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[clips] failed', e);
    return NextResponse.json({ error: 'Could not find clips right now. Try again in a moment.' }, { status: 502 });
  }
}
