import { NextResponse } from 'next/server';
import type Stripe from 'stripe';

import { stripe } from '@/lib/billing/stripe';
import {
  findUserByCustomerId,
  resetUsageWindow,
  setUserTier,
  tierForPrice,
} from '@/lib/billing/sync';

/**
 * Stripe webhook: the only writer of `subscriptionTier`.
 *
 * Signature verification is mandatory and uses the raw request body, so this
 * route must read `await request.text()` rather than `request.json()` -- any
 * re-serialisation changes the bytes and breaks the signature.
 */

export const runtime = 'nodejs';

/** Resolve the local user id for a subscription, from metadata then customer id. */
async function resolveUserId(sub: Stripe.Subscription): Promise<string | null> {
  const fromMetadata = sub.metadata?.userId;
  if (fromMetadata) return fromMetadata;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  if (!customerId) return null;
  return findUserByCustomerId(customerId);
}

/** The tier a subscription grants, from its first line item's price. */
function tierFromSubscription(sub: Stripe.Subscription): string | null {
  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id;
  if (!priceId) return null;
  // Imported statically so the price map and its consumer cannot drift apart.
  return tierForPrice(priceId);
}

export async function POST(request: Request) {
  const client = stripe();
  if (!client) {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error('[billing] STRIPE_WEBHOOK_SECRET is not set; rejecting webhook.');
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'missing_signature' }, { status: 400 });
  }

  // Must be the exact bytes Stripe signed.
  const raw = await request.text();

  let event: Stripe.Event;
  try {
    event = client.webhooks.constructEvent(raw, signature, secret);
  } catch (e) {
    console.warn('[billing] signature verification failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id ?? session.metadata?.userId;
        const tier = session.metadata?.tier;
        if (userId && tier) {
          await setUserTier(userId, tier);
          await resetUsageWindow(userId);
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = await resolveUserId(sub);
        if (!userId) break;
        // Cancelled-but-not-yet-expired still grants access until period end, so
        // only move the tier down on the terminal states.
        const status = sub.status;
        if (status === 'active' || status === 'trialing' || status === 'past_due') {
          const tier = tierFromSubscription(sub);
          if (tier) await setUserTier(userId, tier);
        } else if (status === 'canceled' || status === 'unpaid' || status === 'incomplete_expired') {
          await setUserTier(userId, 'free');
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = await resolveUserId(sub);
        if (userId) await setUserTier(userId, 'free');
        break;
      }

      default:
        // Acknowledge everything else so Stripe stops retrying.
        break;
    }
  } catch (e) {
    console.error(`[billing] handler failed for ${event.type}:`, e instanceof Error ? e.message : e);
    // 500 makes Stripe retry, which is what we want for a transient DB failure.
    return NextResponse.json({ error: 'handler_failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
