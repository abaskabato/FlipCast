/**
 * Plan catalogue for display. Safe to import from client components.
 *
 * Amounts are in cents and must match scripts/stripe-setup.mjs, which creates
 * the Stripe prices. Stripe stays authoritative at checkout; these numbers only
 * decide what the pricing page says.
 */

import { TIER_LIMITS } from '@/lib/quotas';

export type PaidTier = 'creator' | 'agency';
export type BillingPeriod = 'monthly' | 'yearly';

export const PLAN_PRICES: Record<PaidTier, Record<BillingPeriod, number>> = {
  creator: { monthly: 1200, yearly: 12000 },
  agency: { monthly: 3900, yearly: 39000 },
};

export function isPaidTier(v: unknown): v is PaidTier {
  return v === 'creator' || v === 'agency';
}

export function isBillingPeriod(v: unknown): v is BillingPeriod {
  return v === 'monthly' || v === 'yearly';
}

/** 1200 -> "$12", 1250 -> "$12.50". */
export function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

/** Effective monthly price, for "billed yearly" copy. */
export function perMonth(tier: PaidTier, period: BillingPeriod): number {
  const amount = PLAN_PRICES[tier][period];
  return period === 'yearly' ? Math.round(amount / 12) : amount;
}

export const PLAN_MINUTES: Record<string, number> = Object.fromEntries(
  Object.entries(TIER_LIMITS).map(([tier, seconds]) => [tier, Math.round(seconds / 60)]),
);
