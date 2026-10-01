import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getUsage } from '@/lib/usage';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';
import { TIER_LIMITS, maxSourceSeconds, TIER_PRICE_LABEL } from '@/lib/quotas';

export const runtime = 'nodejs';

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
    const usage = await getUsage(session.user.id);
    if (!usage) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

    const tier = usage.tier;
    return NextResponse.json({
      email: session.user.email,
      ...usage,
      tierLabel: TIER_PRICE_LABEL[tier] ?? tier,
      maxSourceSeconds: maxSourceSeconds(tier),
      planLimits: TIER_LIMITS,
    });
  } catch (e) {
    console.error('usage error', e);
    return NextResponse.json({ error: 'Database unreachable' }, { status: 503 });
  }
}