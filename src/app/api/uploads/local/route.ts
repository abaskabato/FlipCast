import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';
import { writeLocal } from '@/lib/storage';

// Dev/small-file fallback when S3 is not configured.
// NOTE: Vercel serverless request bodies cap ~4.5MB — use /api/uploads/presign
// (direct-to-storage PUT) for real video files in production.
export async function POST(request: Request) {
  const ip = clientIp(request.headers);
  if (!checkRateLimit(`uploadlocal:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Rate limited' }, { status: 429 });
  }
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  const key = form?.get('key');
  if (!(file instanceof File) || typeof key !== 'string' || !key) {
    return NextResponse.json({ error: 'file and key required' }, { status: 400 });
  }
  if (!key.startsWith(`uploads/${session.user.id}/`)) {
    return NextResponse.json({ error: 'Invalid key for this user' }, { status: 403 });
  }
  if (!file.type.startsWith('video/')) {
    return NextResponse.json({ error: 'Only video/* uploads allowed' }, { status: 400 });
  }
  if (file.size > 500 * 1024 * 1024) {
    return NextResponse.json({ error: 'File exceeds 500MB' }, { status: 413 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  await writeLocal(key, bytes);
  return NextResponse.json({ key, bytes: bytes.length });
}
