import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { videoJobs, jobOutputs } from '@/db/schema';
import { eq, desc, inArray } from 'drizzle-orm';

export const runtime = 'nodejs';

/**
 * Render history, newest first, with per-format outputs attached.
 *
 * The client keeps output blobs in memory (they never touch the server), so
 * this endpoint reports *what was made*, not the video bytes themselves.
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    const jobs = await db
      .select()
      .from(videoJobs)
      .where(eq(videoJobs.userId, userId))
      .orderBy(desc(videoJobs.createdAt))
      .limit(50);

    const ids = jobs.map((j) => j.id);
    const outputs = ids.length
      ? await db.select().from(jobOutputs).where(inArray(jobOutputs.jobId, ids))
      : [];

    const byJob = new Map<string, typeof outputs>();
    for (const o of outputs) {
      const list = byJob.get(o.jobId) ?? [];
      list.push(o);
      byJob.set(o.jobId, list);
    }

    return NextResponse.json({
      jobs: jobs.map((j) => ({
        id: j.id,
        originalName: j.originalName,
        status: j.status,
        trackingMode: j.trackingMode,
        renderEngine: j.renderEngine,
        progress: j.progress,
        error: j.error,
        sourceWidth: j.sourceWidth,
        sourceHeight: j.sourceHeight,
        sourceDurationSeconds: j.sourceDurationSeconds,
        createdAt: j.createdAt,
        completedAt: j.completedAt,
        outputs: (byJob.get(j.id) ?? []).map((o) => ({
          id: o.id,
          ratio: o.ratio,
          status: o.status,
          width: o.width,
          height: o.height,
          sizeBytes: o.sizeBytes,
        })),
      })),
    });
  } catch (e) {
    console.error('jobs list error', e);
    return NextResponse.json({ error: 'Database unreachable' }, { status: 503 });
  }
}