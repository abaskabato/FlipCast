import { NextResponse } from 'next/server';
import { createReadStream, promises as fs } from 'node:fs';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { videoJobs } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { isS3Configured, presignGet, localPathFor } from '@/lib/storage';

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
    if (job.status !== 'completed' || !job.downloadUrl) {
      return NextResponse.json({ error: `Not ready (status: ${job.status})` }, { status: 409 });
    }
    const key: string = job.downloadUrl;
    if (isS3Configured()) {
      const url = await presignGet(key);
      return NextResponse.redirect(url, 302);
    }
    const full = localPathFor(key);
    await fs.access(full);
    const stream = createReadStream(full);
    // @ts-expect-error Node ReadableStream interop
    return new Response(stream, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${job.originalName.replace(/\.[^.]+$/, '')}_${job.aspectRatioOutput.replace(':', 'x')}.mp4"`,
      },
    });
  } catch (e) {
    console.error('download error', e);
    return NextResponse.json({ error: 'Download unavailable' }, { status: 503 });
  }
}
