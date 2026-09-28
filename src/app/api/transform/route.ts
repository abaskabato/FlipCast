import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { user as userTable, videoJobs } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';
import { tierLimit } from '@/lib/quotas';

type TransformRequest = {
  storageKey?: string;
  fileName?: string;
  targetRatio?: '9:16' | '1:1' | '16:9';
  mode?: 'auto_center' | 'manual_crop' | 'smart_face' | 'manual';
};

const VALID_RATIOS = ['9:16', '1:1', '16:9'] as const;
const VALID_MODES = ['auto_center', 'manual_crop', 'smart_face', 'manual'] as const;

function newJobId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).substring(2, 10)}`;
}

export async function POST(request: Request) {
  const ip = clientIp(request.headers);
  if (!checkRateLimit(`transform:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Rate limited, try again shortly' }, { status: 429 });
  }
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: TransformRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { storageKey, fileName, targetRatio, mode } = body;
  if (!storageKey || !fileName || !targetRatio || !mode) {
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
  }
  if (!VALID_RATIOS.includes(targetRatio as (typeof VALID_RATIOS)[number])) {
    return NextResponse.json({ error: 'Invalid targetRatio' }, { status: 400 });
  }
  if (!VALID_MODES.includes(mode as (typeof VALID_MODES)[number])) {
    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
  }
  if (!storageKey.startsWith(`uploads/${session.user.id}/`)) {
    return NextResponse.json({ error: 'Invalid storageKey for this user' }, { status: 403 });
  }
  if (!/\.(mp4|mov|webm|mkv)$/i.test(storageKey)) {
    return NextResponse.json({ error: 'Unsupported source extension' }, { status: 400 });
  }
  const normalizedMode = mode === 'manual' ? 'manual_crop' : mode;

  try {
    const profiles = await db
      .select({
        used: userTable.monthlyUsageSeconds,
        max: userTable.maxUsageLimit,
        tier: userTable.subscriptionTier,
      })
      .from(userTable)
      .where(eq(userTable.id, session.user.id))
      .limit(1);
    const profile = profiles[0];
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    const effectiveMax = profile.max ?? tierLimit(profile.tier);
    if ((profile.used ?? 0) >= effectiveMax) {
      return NextResponse.json(
        { error: 'Monthly render quota exhausted. Upgrade your tier.' },
        { status: 402 }
      );
    }
    const jobId = newJobId();
    await db.insert(videoJobs).values({
      id: jobId,
      userId: session.user.id,
      originalName: fileName.slice(0, 200),
      storagePath: storageKey,
      status: 'pending',
      aspectRatioOutput: targetRatio,
      trackingMode: normalizedMode,
    });
    return NextResponse.json({
      success: true,
      message: 'Job created successfully',
      job: {
        id: jobId,
        fileName,
        targetRatio,
        mode: normalizedMode,
        status: 'pending' as const,
        persisted: true,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    console.error('transform error', e);
    return NextResponse.json(
      { error: 'Database unreachable. Start Postgres (docker compose up -d) and run db:migrate.' },
      { status: 503 }
    );
  }
}
