import { NextResponse } from 'next/server';

import { clipFindingEnabled } from '@/lib/clips/config';
import { socialConfig } from '@/lib/social/config';

export const runtime = 'nodejs';

/**
 * GET: which optional features this deployment has switched on, so the page
 * only offers (and advertises) what actually works. Public; no secrets.
 */
export function GET() {
  return NextResponse.json({ clips: clipFindingEnabled(), ...socialConfig() });
}
