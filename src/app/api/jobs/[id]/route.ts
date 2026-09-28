import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { videoJobs } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const rows = await db
      .select()
      .from(videoJobs)
      .where(and(eq(videoJobs.id, id), eq(videoJobs.userId, session.user.id)))
      .limit(1);
    const job = rows[0];
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ job });
  } catch (e) {
    console.error('job detail error', e);
    return NextResponse.json({ error: 'Database unreachable' }, { status: 503 });
  }
}
