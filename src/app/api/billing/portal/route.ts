import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { stripe, unavailableReason } from '@/lib/billing/stripe';
import { getStripeCustomerId } from '@/lib/billing/sync';

/**
 * Open the Stripe customer portal, where a subscriber can change plan, update
 * their card, download invoices or cancel. Stripe hosts all of it; the webhook
 * picks up whatever they change there.
 */

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const client = stripe();
  if (!client) {
    return NextResponse.json({ error: 'unavailable', message: unavailableReason() }, { status: 503 });
  }

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const siteUrl = process.env.BETTER_AUTH_URL?.replace(/\/+$/, '');
  if (!siteUrl) {
    return NextResponse.json(
      { error: 'misconfigured', message: 'BETTER_AUTH_URL must be set to open billing.' },
      { status: 503 },
    );
  }

  // Read from the DB rather than the session: the customer id is written after
  // checkout, so a session minted earlier would not carry it.
  const customerId = await getStripeCustomerId(session.user.id);
  if (!customerId) {
    return NextResponse.json(
      { error: 'no_customer', message: 'There is no billing account for this user yet.' },
      { status: 404 },
    );
  }

  // Only same-site paths, so the portal cannot be used as an open redirect.
  const body = (await request.json().catch(() => ({}))) as { returnPath?: unknown };
  const returnPath =
    typeof body.returnPath === 'string' && /^\/[a-z-]*$/.test(body.returnPath) ? body.returnPath : '/';

  try {
    // Receipts go to the customer's email, which can drift after the user
    // changes theirs on /account. Best effort: never block the portal on it.
    await client.customers
      .update(customerId, { email: session.user.email })
      .catch((e) => console.warn('[billing] customer email sync failed:', e instanceof Error ? e.message : e));

    const portal = await client.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${siteUrl}${returnPath}`,
      // Created by scripts/stripe-setup.mjs. Without it Stripe falls back to
      // the dashboard default, which does not exist until saved by hand.
      ...(process.env.STRIPE_PORTAL_CONFIG_ID?.trim()
        ? { configuration: process.env.STRIPE_PORTAL_CONFIG_ID.trim() }
        : {}),
    });
    return NextResponse.json({ url: portal.url });
  } catch (e) {
    console.error('[billing] portal failed:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: 'portal_failed', message: 'Could not open billing. Please try again.' },
      { status: 502 },
    );
  }
}
