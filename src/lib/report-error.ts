'use client';

import { isNoise, type ClientErrorKind } from './client-errors';

/** Each tab reports at most this many errors, and each distinct one once. */
const MAX_REPORTS = 20;
const reported = new Set<string>();

/**
 * Tell the server about an error the user hit, for /admin. Fire and forget:
 * reporting must never cause an error of its own.
 */
export function reportError(kind: ClientErrorKind, error: unknown): void {
  try {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    const key = `${kind}:${message}`;
    if (!message || isNoise(message, stack) || reported.has(key) || reported.size >= MAX_REPORTS) return;
    reported.add(key);
    void fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, message, stack, path: window.location.pathname }),
      // Still delivered if the tab is closing.
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* never let reporting fail loudly */
  }
}
