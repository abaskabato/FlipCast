import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { billingEnabled, isPurchasable, PLAN_IDS, stripe, unavailableReason } from '@/lib/billing/stripe';
import { getBillingState, setStripeCustomerId } from '@/lib/billing/sync';

/**
 * Create a Stripe Checkout session for a paid plan.
 *
 * Returns 503 with an actionable reason when billing is not configured, so the
 * free product keeps working unchanged and the UI can say something useful
 * instead of a bare failure.
 */

export const runtime = 'nodejs';

const Body = z.object({
  tier: z.enum(['creator', 'agency']),
  period: z.enum(['monthly', 'yearly']).default('monthly'),
});

export async function POST(request: Request) {
  const client = stripe();
  // billingEnabled() also refuses a test-mode key on the live site.
  if (!client || !billingEnabled()) {
    return NextResponse.json(
      { error: 'unavailable', message: unavailableReason() },
      { status: 503 },
    );
  }

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_plan' }, { status: 400 });
  }

  const { tier, period } = parsed.data;
  const price = PLAN_IDS[tier][period];

  if (!isPurchasable(tier, period)) {
    return NextResponse.json(
      { error: 'unavailable', message: unavailableReason() },
      { status: 503 },
    );
  }

  // Prefer the canonical site URL over any forwarded host header, which an
  // attacker could set to redirect a victim to a lookalike page after checkout.
  const siteUrl = process.env.BETTER_AUTH_URL?.replace(/\/+$/, '');
  if (!siteUrl) {
    return NextResponse.json(
      { error: 'misconfigured', message: 'BETTER_AUTH_URL must be set to start checkout.' },
      { status: 503 },
    );
  }

  // Fresh from the DB: the session may predate checkout or a tier change.
  const billing = await getBillingState(session.user.id);
  if (!billing) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // A second checkout would create a second, parallel subscription. Plan
  // changes for existing subscribers go through the billing portal instead.
  if (billing.tier !== 'free') {
    return NextResponse.json(
      {
        error: 'already_subscribed',
        message: 'You already have a paid plan. Use “Manage billing” to change it.',
      },
      { status: 409 },
    );
  }

  const user = { email: session.user.email, stripeCustomerId: billing.customerId };

  try {
    const checkout = await client.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      // Reuse the customer so upgrades attach to one record instead of creating
      // a duplicate per purchase.
      // Subscription mode always creates a customer on completion
      // (`customer_creation` is payment-mode only and is rejected here); the
      // webhook stores its id.
      ...(user.stripeCustomerId
        ? { customer: user.stripeCustomerId }
        : { customer_email: user.email }),
      client_reference_id: session.user.id,
      allow_promotion_codes: true,
      success_url: `${siteUrl}/?upgraded=1`,
      cancel_url: `${siteUrl}/?cancelled=1`,
      // success_url/cancel_url are built from BETTER_AUTH_URL rather than any
      // request header, so a spoofed Host cannot redirect a paying customer to a
      // lookalike page after checkout.
      subscription_data: {
        metadata: { userId: session.user.id, tier },
      },
      metadata: { userId: session.user.id, tier, period },
    });

    if (!user.stripeCustomerId && checkout.customer) {
      const customerId =
        typeof checkout.customer === 'string' ? checkout.customer : checkout.customer.id;
      await setStripeCustomerId(session.user.id, customerId);
    }

    if (!checkout.url) {
      return NextResponse.json(
        { error: 'no_url', message: 'Stripe did not return a checkout URL.' },
        { status: 502 },
      );
    }

    return NextResponse.json({ url: checkout.url });
  } catch (e) {
    console.error('[billing] checkout failed:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: 'checkout_failed', message: 'Could not start checkout. Please try again.' },
      { status: 502 },
    );
  }
}
