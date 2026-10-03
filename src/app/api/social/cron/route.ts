import { NextResponse } from 'next/server';
import { del, get } from '@vercel/blob';

import { runScheduler } from '@/lib/social/scheduler';

export const runtime = 'nodejs';
// Streaming a few clips to TikTok can take a while.
export const maxDuration = 300;

/**
 * GET: the TikTok scheduler, run by Vercel Cron. Vercel sends
 * `Authorization: Bearer $CRON_SECRET`; anything else is refused.
 *
 * Needs an every-few-minutes cron, which Vercel Hobby does not allow (a
 * deployment with one fails), so add it to vercel.json only on Pro:
 *   "crons": [{ "path": "/api/social/cron", "schedule": "*\/5 * * * *" }]
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const report = await runScheduler({
    open: async (pathname) => {
      const r = await get(pathname, { access: 'private', useCache: false });
      if (!r || r.statusCode !== 200) return null;
      return { stream: r.stream, size: r.blob.size, contentType: r.blob.contentType };
    },
    remove: (pathname) => del(pathname),
  });
  return NextResponse.json(report);
}
