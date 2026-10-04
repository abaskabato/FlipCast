import { NextResponse } from 'next/server';
import type Stripe from 'stripe';

import { stripe, testModeAllowed } from '@/lib/billing/stripe';
import {
  findUserByCustomerId,
  getBillingState,
  resetUsageWindow,
  setStripeCustomerId,
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

/**
 * Set the user's tier from the subscription as it is *now*, fetched from
 * Stripe, not from the event's snapshot. Events can arrive late, twice or out
 * of order; a stale "active" processed after "deleted" must not re-grant a
 * paid plan, and reading current state makes every delivery idempotent.
 */
async function applySubscription(client: Stripe, subscriptionId: string, userId: string): Promise<void> {
  const sub = await client.subscriptions.retrieve(subscriptionId);
  const status = sub.status;
  // Cancelled-but-not-yet-expired still grants access until period end
  // (status stays active with cancel_at_period_end), so only the terminal
  // states move the tier down. past_due keeps access while Stripe retries.
  if (status === 'active' || status === 'trialing' || status === 'past_due') {
    const tier = tierFromSubscription(sub);
    if (!tier) return;
    const before = await getBillingState(userId);
    await setUserTier(userId, tier);
    // A new subscription starts a fresh usage window, once.
    if (before?.tier === 'free') await resetUsageWindow(userId);
  } else if (status === 'canceled' || status === 'unpaid' || status === 'incomplete_expired') {
    await setUserTier(userId, 'free');
  }
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

  // A test-mode payment must never grant a plan on the live site. Answer 200
  // so Stripe does not keep retrying, but change nothing.
  if (!event.livemode && !testModeAllowed()) {
    console.warn(`[billing] ignored test-mode ${event.type} on the live site`);
    return NextResponse.json({ received: true, ignored: 'test_mode' });
  }

  try {
    switch (event.type) {
      // Checkout finished. With a delayed payment method (bank debits) the
      // session completes before the money arrives: payment_status is then
      // "unpaid" and access waits for async_payment_succeeded.
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id ?? session.metadata?.userId;
        if (!userId) break;
        // The customer only exists once checkout completes, so this is where
        // its id is first known. The portal and repeat checkouts need it.
        const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
        if (customerId) await setStripeCustomerId(userId, customerId);
        if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') break;
        const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
        if (subId) await applySubscription(client, subId, userId);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = await resolveUserId(sub);
        if (userId) await applySubscription(client, sub.id, userId);
        break;
      }

      default:
        // Acknowledge everything else so Stripe stops retrying.
        break;
    }
  } catch (e) {
    console.error(`[billing] handler failed for ${event.type}:`, e instanceof Error ? e.message : e);
    // 500 makes Stripe retry, which is what we want for a transient failure.
    return NextResponse.json({ error: 'handler_failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
