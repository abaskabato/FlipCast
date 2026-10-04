import { randomUUID } from 'node:crypto';

import { lt } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/db';
import { clientErrors } from '@/db/schema';
import { auth } from '@/lib/auth';
import { CLIENT_ERROR_KINDS, isNoise, scrub, type ClientErrorKind } from '@/lib/client-errors';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const KEEP_DAYS = 30;

/**
 * POST /api/client-errors { kind, message, stack?, path? } -> 204
 *
 * Stores an error from a user's browser (see src/lib/report-error.ts) for
 * /admin. Works signed out too, since many failures happen before sign-in.
 */
export async function POST(request: Request) {
  if (!checkRateLimit(`client-errors:${clientIp(request.headers)}`, 30, 60_000)) {
    return new NextResponse(null, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const kind = body?.kind as ClientErrorKind;
  const message = scrub(typeof body?.message === 'string' ? body.message : null, 500);
  const stack = scrub(typeof body?.stack === 'string' ? body.stack : null, 2000);
  if (!CLIENT_ERROR_KINDS.includes(kind) || !message || isNoise(message, stack)) {
    return new NextResponse(null, { status: 204 });
  }
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);

  await db.insert(clientErrors).values({
    id: randomUUID(),
    userId: session?.user?.id ?? null,
    kind,
    message,
    stack,
    path: typeof body?.path === 'string' ? body.path.slice(0, 100) : null,
    userAgent: request.headers.get('user-agent')?.slice(0, 200) ?? null,
  });
  // Prune now and then rather than on a schedule.
  if (Math.random() < 0.05) {
    await db
      .delete(clientErrors)
      .where(lt(clientErrors.createdAt, new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000)))
      .catch(() => undefined);
  }
  return new NextResponse(null, { status: 204 });
}
