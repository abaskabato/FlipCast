import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { videoJobs } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const rows = await db
      .select()
      .from(videoJobs)
      .where(eq(videoJobs.userId, session.user.id))
      .orderBy(desc(videoJobs.createdAt))
      .limit(50);
    return NextResponse.json({ jobs: rows });
  } catch (e) {
    console.error('jobs list error', e);
    return NextResponse.json({ error: 'Database unreachable' }, { status: 503 });
  }
}
