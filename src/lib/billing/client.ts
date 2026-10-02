'use client';

import type { BillingPeriod, PaidTier } from './plans';

/**
 * Browser side of billing. Every path ends in a full-page navigation to a
 * Stripe-hosted page, or in a message the caller can show.
 */

export type BillingOutcome =
  | { kind: 'redirected' }
  | { kind: 'signin' }
  | { kind: 'message'; message: string };

async function postForUrl(path: string, body?: unknown): Promise<{ status: number; url?: string; message?: string; error?: string }> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; message?: string; error?: string };
  return { status: res.status, ...data };
}

/** Open the Stripe customer portal for the signed-in user. */
export async function openBillingPortal(): Promise<BillingOutcome> {
  try {
    const r = await postForUrl('/api/billing/portal');
    if (r.url) {
      window.location.href = r.url;
      return { kind: 'redirected' };
    }
    if (r.status === 401) return { kind: 'signin' };
    return { kind: 'message', message: r.message ?? 'Could not open billing. Please try again.' };
  } catch {
    return { kind: 'message', message: 'Could not reach the server to open billing.' };
  }
}

/**
 * Start Stripe Checkout. A signed-out caller gets `signin` back and should
 * send the user to sign in with the plan remembered (see `checkoutIntentUrl`).
 * An existing subscriber is sent to the portal instead, where plan changes
 * are prorated rather than creating a second subscription.
 */
export async function startCheckout(tier: PaidTier, period: BillingPeriod): Promise<BillingOutcome> {
  try {
    const r = await postForUrl('/api/billing/checkout', { tier, period });
    if (r.url) {
      window.location.href = r.url;
      return { kind: 'redirected' };
    }
    if (r.status === 401) return { kind: 'signin' };
    if (r.error === 'already_subscribed') return openBillingPortal();
    return { kind: 'message', message: r.message ?? 'Could not start checkout. Please try again.' };
  } catch {
    return { kind: 'message', message: 'Could not reach the server to start checkout.' };
  }
}

/** Home page URL that resumes checkout for `tier` once the user has signed in. */
export function checkoutIntentUrl(tier: PaidTier, period: BillingPeriod): string {
  return `/?plan=${tier}&period=${period}#account`;
}
