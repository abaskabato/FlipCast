import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const REGION = process.env.STORAGE_REGION || 'us-east-1';
const BUCKET = process.env.STORAGE_BUCKET || 'flipcast';
const ENDPOINT = process.env.STORAGE_ENDPOINT || '';
const ACCESS_KEY = process.env.STORAGE_ACCESS_KEY || '';
const SECRET_KEY = process.env.STORAGE_SECRET_KEY || '';
const PATH_STYLE = (process.env.STORAGE_FORCE_PATH_STYLE || '').toLowerCase() === 'true';
const LOCAL_DIR = process.env.STORAGE_LOCAL_DIR || path.join(process.cwd(), 'storage');

export function isS3Configured(): boolean {
  return Boolean(ACCESS_KEY && SECRET_KEY && (ENDPOINT || REGION));
}

let client: S3Client | null = null;
export function s3Client(): S3Client {
  if (client) return client;
  client = new S3Client({
    region: REGION,
    endpoint: ENDPOINT || undefined,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    forcePathStyle: PATH_STYLE || Boolean(ENDPOINT),
  });
  return client;
}

export function bucketName(): string {
  return BUCKET;
}

export function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'video.mp4';
}

export async function presignPut(key: string, contentType: string): Promise<string> {
  const url = await getSignedUrl(
    s3Client(),
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: 900 }
  );
  return url;
}

export async function presignGet(key: string): Promise<string> {
  const url = await getSignedUrl(s3Client(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn: 3600,
  });
  return url;
}

export function localPathFor(key: string): string {
  return path.join(LOCAL_DIR, key);
}

export async function writeLocal(key: string, bytes: Uint8Array): Promise<string> {
  const full = localPathFor(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes);
  return full;
}

export function publicBaseUrl(): string {
  return process.env.STORAGE_PUBLIC_BASE_URL || '';
}
