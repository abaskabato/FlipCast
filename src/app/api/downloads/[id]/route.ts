import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * Explains why there is no download endpoint for local renders.
 *
 * Renders are produced in the user's browser and handed to them as a Blob, so
 * the video bytes never reach our servers and there is nothing here to serve.
 * Downloads happen client-side via an object URL.
 *
 * This route is kept so the old link does not 404 confusingly, and so the
 * transition to server-side rendering has an obvious place to land.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(
    {
      error: 'Renders are produced locally in your browser, so there is no server-side file to download.',
      jobId: id,
      hint: 'Download the file from the studio panel, or re-run the render for this job.',
    },
    { status: 409 },
  );
}