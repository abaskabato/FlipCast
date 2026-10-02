import 'server-only';
import Stripe from 'stripe';

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

export type PaidTier = keyof typeof PLAN_IDS;
export type BillingPeriod = 'monthly' | 'yearly';

let cached: Stripe | null | undefined;

/**
 * The Stripe client, or null when billing is not configured.
 *
 * Memoized because constructing a client throws on a malformed key, and this is
 * called per-request. `undefined` = not yet tried, `null` = tried and absent.
 */
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
    });
  } catch (e) {
    console.error('[stripe] could not construct client:', e instanceof Error ? e.message : e);
    cached = null;
  }
  return cached;
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
  return 'This plan cannot be purchased right now.';
}

/** Customer-facing price display, kept out of the components. */
export const PLAN_DISPLAY: Record<PaidTier, { name: string; blurb: string; minutes: number }> = {
  creator: { name: 'Creator', blurb: 'For one channel, every week.', minutes: 60 },
  agency: { name: 'Agency', blurb: 'For teams shipping client work.', minutes: 240 },
};
