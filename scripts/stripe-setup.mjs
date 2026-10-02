/**
 * One-shot Stripe catalogue setup. Idempotent: re-running reuses what exists.
 *
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs https://your-domain
 *
 * Creates:
 *   - Creator and Agency products, each with a monthly and a yearly price,
 *     found again on later runs by their lookup_key;
 *   - a webhook endpoint at <domain>/api/billing/webhook for the four events
 *     the handler understands;
 *   - a customer-portal configuration that lets subscribers switch between the
 *     four prices, update their card, see invoices and cancel.
 *
 * Prints the env vars to set. The webhook signing secret is only returned when
 * the endpoint is first created, so if the endpoint already exists it is left
 * alone and you are told where to find the secret.
 *
 * Amounts must match PLAN_PRICES in src/lib/billing/plans.ts.
 */
import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY?.trim();
const site = process.argv[2]?.replace(/\/+$/, '');
if (!key || !site || !/^https:\/\//.test(site)) {
  console.error('usage: STRIPE_SECRET_KEY=sk_... node scripts/stripe-setup.mjs https://your-domain');
  process.exit(1);
}

const stripe = new Stripe(key);
const live = key.startsWith('sk_live_');

const PLANS = [
  { tier: 'creator', name: 'Flipcast Creator', monthly: 1200, yearly: 12000 },
  { tier: 'agency', name: 'Flipcast Agency', monthly: 3900, yearly: 39000 },
];

const EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
];

async function ensurePrice(product, tier, period, amount) {
  const lookup_key = `flipcast_${tier}_${period}`;
  const existing = await stripe.prices.list({ lookup_keys: [lookup_key], active: true, limit: 1 });
  const found = existing.data[0];
  if (found && found.unit_amount === amount) return found;
  // A changed amount gets a new price; transfer_lookup_key moves the key over
  // so the old price stops being found.
  return stripe.prices.create({
    product,
    currency: 'usd',
    unit_amount: amount,
    recurring: { interval: period === 'monthly' ? 'month' : 'year' },
    lookup_key,
    transfer_lookup_key: true,
  });
}

async function ensureProduct(tier, name) {
  const found = await stripe.products.search({ query: `metadata['flipcast_tier']:'${tier}'` });
  if (found.data[0]) return found.data[0];
  return stripe.products.create({ name, metadata: { flipcast_tier: tier } });
}

const env = {};
const portalProducts = [];

for (const plan of PLANS) {
  const product = await ensureProduct(plan.tier, plan.name);
  const monthly = await ensurePrice(product.id, plan.tier, 'monthly', plan.monthly);
  const yearly = await ensurePrice(product.id, plan.tier, 'yearly', plan.yearly);
  env[`STRIPE_PRICE_${plan.tier.toUpperCase()}_MONTHLY`] = monthly.id;
  env[`STRIPE_PRICE_${plan.tier.toUpperCase()}_YEARLY`] = yearly.id;
  portalProducts.push({ product: product.id, prices: [monthly.id, yearly.id] });
  console.log(`+ ${plan.name}: ${monthly.id} (monthly), ${yearly.id} (yearly)`);
}

// ---- webhook ----
const webhookUrl = `${site}/api/billing/webhook`;
const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
const existingHook = endpoints.data.find((e) => e.url === webhookUrl);
if (existingHook) {
  await stripe.webhookEndpoints.update(existingHook.id, { enabled_events: EVENTS, disabled: false });
  console.log(`= webhook ${existingHook.id} already exists (events refreshed)`);
  console.log('  Its signing secret is shown once at creation; reveal it in the Stripe');
  console.log(`  dashboard → Developers → Webhooks → ${webhookUrl}`);
} else {
  const hook = await stripe.webhookEndpoints.create({ url: webhookUrl, enabled_events: EVENTS });
  env.STRIPE_WEBHOOK_SECRET = hook.secret;
  console.log(`+ webhook ${hook.id} -> ${webhookUrl}`);
}

// ---- customer portal ----
const portalParams = {
  metadata: { flipcast: 'portal' },
  business_profile: {
    headline: 'Manage your Flipcast plan',
    privacy_policy_url: `${site}/privacy`,
    terms_of_service_url: `${site}/terms`,
  },
  features: {
    customer_update: { enabled: true, allowed_updates: ['email', 'address'] },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: 'at_period_end' },
    subscription_update: {
      enabled: true,
      default_allowed_updates: ['price'],
      proration_behavior: 'create_prorations',
      products: portalProducts,
    },
  },
};
const configs = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
const existingPortal = configs.data.find((c) => c.metadata?.flipcast === 'portal');
const portal = existingPortal
  ? await stripe.billingPortal.configurations.update(existingPortal.id, portalParams)
  : await stripe.billingPortal.configurations.create(portalParams);
env.STRIPE_PORTAL_CONFIG_ID = portal.id;
console.log(`${existingPortal ? '=' : '+'} portal configuration ${portal.id}`);

console.log(`\nSet these on the server (${live ? 'LIVE' : 'test'} mode):\n`);
for (const [k, v] of Object.entries(env)) console.log(`${k}=${v}`);
console.log('');
