import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { user as userTable } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';

export async function GET(request: Request) {
  const ip = clientIp(request.headers);
  if (!checkRateLimit(`usage:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429 });
  }
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const rows = await db
      .select({
        tier: userTable.subscriptionTier,
        used: userTable.monthlyUsageSeconds,
        max: userTable.maxUsageLimit,
        email: userTable.email,
      })
      .from(userTable)
      .where(eq(userTable.id, session.user.id))
      .limit(1);
    const row = rows[0];
    if (!row) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    return NextResponse.json({
      email: row.email,
      tier: row.tier,
      usedSeconds: row.used,
      maxSeconds: row.max,
    });
  } catch (e) {
    console.error('usage error', e);
    return NextResponse.json({ error: 'Database unreachable' }, { status: 503 });
  }
}
