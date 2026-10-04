import { and, eq, gt, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/db';
import { user as userTable } from '@/db/schema';
import { auth } from '@/lib/auth';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';
import { cleanReferrer, cleanSource } from '@/lib/signup-source';

export const runtime = 'nodejs';

/** Accounts older than this keep whatever they have: it is about sign-ups. */
const NEW_ACCOUNT_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * POST /api/me/source { source, referrer } -> 204
 *
 * Records where a new account came from (see SourceCapture). Set once: an
 * account that already has a source, or is more than two days old, is left
 * alone, so it cannot be rewritten later.
 */
export async function POST(request: Request) {
  if (!checkRateLimit(`source:${clientIp(request.headers)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429 });
  }
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { source?: unknown; referrer?: unknown } | null;
  const source = cleanSource(typeof body?.source === 'string' ? body.source : null);
  // The browser already reduced it to a host; accept only a bare host.
  const referrer = typeof body?.referrer === 'string' ? cleanReferrer(`https://${body.referrer}`) : null;

  await db
    .update(userTable)
    .set({ signupSource: source ?? 'direct', signupReferrer: referrer })
    .where(
      and(
        eq(userTable.id, session.user.id),
        isNull(userTable.signupSource),
        gt(userTable.createdAt, new Date(Date.now() - NEW_ACCOUNT_MS)),
      ),
    );
  return new NextResponse(null, { status: 204 });
}
