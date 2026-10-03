import { NextResponse } from 'next/server';

import { socialConfig } from '@/lib/social/config';

export const runtime = 'nodejs';

/** GET: which publishing features this deployment offers. Public; no secrets. */
export function GET() {
  return NextResponse.json(socialConfig());
}
