import { NextResponse } from 'next/server';

import { jsonError, userIdFrom } from '@/lib/social/http';
import { listPosts } from '@/lib/social/store';

export const runtime = 'nodejs';

/** GET: the signed-in user's recent and upcoming posts. */
export async function GET(request: Request) {
  const userId = await userIdFrom(request);
  if (!userId) return jsonError('Sign in first.', 401);
  const posts = await listPosts(userId);
  return NextResponse.json({
    posts: posts.map((p) => ({
      id: p.id,
      platform: p.platform,
      accountName: p.accountName,
      status: p.status,
      title: p.title,
      privacy: p.privacy,
      scheduledAt: p.scheduledAt?.toISOString() ?? null,
      postedAt: p.postedAt?.toISOString() ?? null,
      url: p.url,
      error: p.error,
      createdAt: p.createdAt.toISOString(),
    })),
  });
}
