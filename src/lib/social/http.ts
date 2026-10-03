/**
 * Shared bits for the /api/social routes. Node only.
 */

import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { PlatformError } from './youtube';

export async function userIdFrom(request: Request): Promise<string | null> {
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  return session?.user?.id ?? null;
}

export const jsonError = (message: string, status: number, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error: message, ...extra }, { status });

/** Platform failures become readable errors; `reconnect` tells the UI to offer reconnecting. */
export function platformErrorResponse(e: unknown, fallback: string) {
  if (e instanceof PlatformError) return jsonError(e.message, e.status, { reconnect: e.reconnect });
  console.error('[social]', e);
  return jsonError(fallback, 502);
}
