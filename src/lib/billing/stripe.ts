import 'server-only';
import Stripe from 'stripe';

import type { BillingPeriod } from './plans';

/**
 * Stripe access.
 *
 * Stripe is optional by design. Flipcast renders video in the user's browser, so
 * the product works with zero paid infrastructure and billing is purely additive
 * margin. That means a missing key must degrade to "upgrade unavailable", never
 * to a broken app or a build failure -- so this module is lazy and every caller
 * must handle `stripe()` returning null.
 *
 * To enable payments: set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET, then
 * create products/prices and add their IDs to PLANS below.
 */

export const PLAN_IDS = {
  creator: {
    monthly: process.env.STRIPE_PRICE_CREATOR_MONTHLY ?? '',
    yearly: process.env.STRIPE_PRICE_CREATOR_YEARLY ?? '',
  },
  agency: {
    monthly: process.env.STRIPE_PRICE_AGENCY_MONTHLY ?? '',
    yearly: process.env.STRIPE_PRICE_AGENCY_YEARLY ?? '',
  },
} as const;

export type { BillingPeriod, PaidTier } from './plans';

let cached: Stripe | null | undefined;

/**
 * The Stripe client, or null when billing is not configured.
 *
 * Memoized because constructing a client throws on a malformed key, and this is
 * called per-request. `undefined` = not yet tried, `null` = tried and absent.
 */
function apiBase(raw: string) {
  const u = new URL(raw);
  return { host: u.hostname, port: Number(u.port) || undefined, protocol: u.protocol.replace(':', '') as 'http' | 'https' };
}

export function stripe(): Stripe | null {
  if (cached !== undefined) return cached;

  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    console.warn('[stripe] STRIPE_SECRET_KEY is not set; paid plans are unavailable.');
    cached = null;
    return cached;
  }

  try {
    cached = new Stripe(key, {
      // Pinned to the version this code is written against: `2026-08-26.dahlia`.
      // Bumping the Stripe dependency without updating this string is a type
      // error, which is the point -- a silent upgrade could otherwise change
      // webhook payload shapes underneath the handlers.
      apiVersion: '2026-08-26.dahlia',
      typescript: true,
      appInfo: { name: 'Flipcast', version: '1.0.0' },
      // Tests point the client at a local stand-in (scripts/verify-billing.mjs).
      ...(process.env.STRIPE_API_BASE ? apiBase(process.env.STRIPE_API_BASE) : {}),
    });
  } catch (e) {
    console.error('[stripe] could not construct client:', e instanceof Error ? e.message : e);
    cached = null;
  }
  return cached;
}

/** Live or test, from the key's prefix. Anything that is not a live key counts as test. */
export function stripeKeyMode(): 'live' | 'test' | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  return /^(sk|rk)_live_/.test(key) ? 'live' : 'test';
}

/**
 * Whether test-mode payments may grant plans on this deployment. Never on the
 * live site: anyone could otherwise buy a plan with Stripe's public test card.
 * Previews, local runs and tests use test keys freely; a production deployment
 * can opt in on purpose with STRIPE_ALLOW_TEST_MODE=1 (e.g. a staging domain).
 */
export function testModeAllowed(): boolean {
  return process.env.VERCEL_ENV !== 'production' || process.env.STRIPE_ALLOW_TEST_MODE === '1';
}

/** True when paid plans can be bought on this deployment. */
export function billingEnabled(): boolean {
  const mode = stripeKeyMode();
  return Boolean(mode && PLAN_IDS.creator.monthly && (mode === 'live' || testModeAllowed()));
}

/** True when a tier can actually be purchased right now. */
export function isPurchasable(tier: string, period: BillingPeriod): boolean {
  if (tier !== 'creator' && tier !== 'agency') return false;
  return Boolean(PLAN_IDS[tier][period]);
}

/**
 * Why checkout is unavailable. The returned text is shown to customers, so the
 * operator-facing detail (which env var is missing) goes to the server log.
 */
export function unavailableReason(): string {
  if (!stripe()) {
    console.warn('[billing] checkout requested but STRIPE_SECRET_KEY is not set.');
    return 'Paid plans are coming soon. Your free allowance keeps working in the meantime.';
  }
  if (!isPurchasable('creator', 'monthly')) {
    console.warn('[billing] checkout requested but STRIPE_PRICE_* is not set.');
    return 'Paid plans are coming soon. Your free allowance keeps working in the meantime.';
  }
  if (!billingEnabled()) {
    console.warn('[billing] checkout requested but the Stripe key is a test key on the live site.');
    return 'Paid plans are coming soon. Your free allowance keeps working in the meantime.';
  }
  return 'This plan cannot be purchased right now.';
}
