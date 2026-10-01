import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { user as userTable } from '@/db/schema';
import { PLAN_IDS } from './stripe';

/**
 * Tier sync from Stripe.
 *
 * The webhook is the only writer of `subscriptionTier`. Never trust the client to
 * report what it paid for: `/api/transform` reads this column to decide quota, so
 * a client-settable tier would be a trivially bypassable paywall.
 */

/**
 * Map a Stripe price ID to the tier it grants.
 *
 * Built from the same env vars the checkout route uses, so a price can never be
 * sold for one tier and credited as another.
 */
export function tierForPrice(priceId: string): 'creator' | 'agency' | null {
  for (const [tier, prices] of Object.entries(PLAN_IDS)) {
    for (const id of Object.values(prices)) {
      if (id && id === priceId) return tier as 'creator' | 'agency';
    }
  }
  return null;
}

/** Set a user's tier. Returns false when no user matched. */
export async function setUserTier(userId: string, tier: string): Promise<boolean> {
  const rows = await db
    .update(userTable)
    .set({ subscriptionTier: tier, updatedAt: new Date() })
    .where(eq(userTable.id, userId))
    .returning({ id: userTable.id });
  return rows.length > 0;
}

/** Attach (or reuse) a Stripe customer so a user never gets two. */
export async function setStripeCustomerId(userId: string, customerId: string): Promise<void> {
  await db
    .update(userTable)
    .set({ stripeCustomerId: customerId, updatedAt: new Date() })
    .where(eq(userTable.id, userId));
}

/** Find a user by the Stripe customer ID stored at checkout time. */
export async function findUserByCustomerId(customerId: string): Promise<string | null> {
  const rows = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.stripeCustomerId, customerId))
    .limit(1);
  return rows[0]?.id ?? null;
}

/** Refresh `monthlyUsageSeconds` bookkeeping when a subscription starts. */
export async function resetUsageWindow(userId: string): Promise<void> {
  await db
    .update(userTable)
    .set({ usagePeriodStart: new Date(), updatedAt: new Date() })
    .where(eq(userTable.id, userId));
}
