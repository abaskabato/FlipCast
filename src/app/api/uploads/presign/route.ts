import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';
import { isS3Configured, presignPut, safeFileName } from '@/lib/storage';

const ALLOWED_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'];

export async function POST(request: Request) {
  const ip = clientIp(request.headers);
  if (!checkRateLimit(`presign:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Rate limited, try again shortly' }, { status: 429 });
  }
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: { fileName?: string; contentType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { fileName, contentType } = body;
  if (!fileName || !contentType) {
    return NextResponse.json({ error: 'fileName and contentType required' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(contentType)) {
    return NextResponse.json(
      { error: `Unsupported content type. Allowed: ${ALLOWED_TYPES.join(', ')}` },
      { status: 400 }
    );
  }
  if (!isS3Configured()) {
    return NextResponse.json(
      { error: 'Object storage not configured. Set STORAGE_* env (see .env.example / docker compose MinIO).' },
      { status: 503 }
    );
  }
  const jobId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`;
  const key = `uploads/${session.user.id}/${jobId}/${safeFileName(fileName)}`;
  const putUrl = await presignPut(key, contentType);
  return NextResponse.json({ key, putUrl, jobHint: jobId });
}
