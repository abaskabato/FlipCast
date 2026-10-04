/**
 * Verifies the Stripe webhook handler with correctly signed events, a local
 * stand-in for the Stripe API and a local Postgres:
 *
 *  - an unsigned or wrongly signed event is refused;
 *  - checkout completing with payment still pending stores the customer but
 *    grants nothing; the delayed-payment success then grants the plan;
 *  - the plan comes from the subscription's current state in Stripe, so a
 *    duplicate is harmless and a stale "active" event after cancellation does
 *    not re-grant the plan;
 *  - a failure talking to Stripe answers 500 so Stripe retries;
 *  - on the live site (VERCEL_ENV=production) a test-mode payment grants
 *    nothing, checkout refuses a test key and the pricing page stays closed.
 *
 * Needs a throwaway database, never production:
 *   BILLING_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/flipcast_test npm run verify:billing
 */
import http from 'node:http';

const dbUrl = process.env.BILLING_TEST_DATABASE_URL;
if (!dbUrl || !['127.0.0.1', 'localhost'].includes(new URL(dbUrl).hostname)) {
  console.error('Refusing to run: BILLING_TEST_DATABASE_URL must point at a local throwaway database.');
  process.exit(2);
}

let failed = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
};

// What GET /v1/subscriptions/:id returns right now.
const subs = new Map();
let stripeDown = false;
const server = http.createServer((req, res) => {
  const m = /^\/v1\/subscriptions\/([\w-]+)/.exec(req.url);
  if (stripeDown) { res.writeHead(500, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { type: 'api_error', message: 'down' } })); }
  if (m && subs.has(m[1])) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(subs.get(m[1]))); }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'No such subscription' } }));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const SECRET = 'whsec_test_secret';
Object.assign(process.env, {
  DATABASE_URL: dbUrl,
  STRIPE_SECRET_KEY: 'sk_test_dummy',
  STRIPE_WEBHOOK_SECRET: SECRET,
  STRIPE_API_BASE: `http://127.0.0.1:${server.address().port}`,
  STRIPE_PRICE_CREATOR_MONTHLY: 'price_creator_m',
  STRIPE_PRICE_CREATOR_YEARLY: 'price_creator_y',
  STRIPE_PRICE_AGENCY_MONTHLY: 'price_agency_m',
  STRIPE_PRICE_AGENCY_YEARLY: 'price_agency_y',
});
delete process.env.DATABASE_URL_POOLED;

const { default: Stripe } = await import('stripe');
const { POST } = await import('../src/app/api/billing/webhook/route.ts');
const { db, pool } = await import('../src/db/index.ts');
const schema = await import('../src/db/schema.ts');
const { eq } = await import('drizzle-orm');

const signer = new Stripe('sk_test_dummy');
let n = 0;
const deliver = async (type, object, { secret = SECRET, livemode } = {}) => {
  const payload = JSON.stringify({ id: `evt_${++n}`, object: 'event', type, data: { object }, api_version: '2026-08-26.dahlia', created: Math.floor(Date.now() / 1000), ...(livemode === undefined ? {} : { livemode }) });
  const signature = signer.webhooks.generateTestHeaderString({ payload, secret });
  const res = await POST(new Request('http://x/api/billing/webhook', { method: 'POST', headers: { 'stripe-signature': signature }, body: payload }));
  return res.status;
};
const userRow = async () => (await db.select().from(schema.user).where(eq(schema.user.id, 'bill-1')))[0];
const sub = (id, status, price = 'price_creator_m') => ({ id, object: 'subscription', status, customer: 'cus_1', metadata: { userId: 'bill-1' }, items: { object: 'list', data: [{ id: 'si_1', price: { id: price } }] } });

try {
  await db.delete(schema.user).where(eq(schema.user.id, 'bill-1'));
  await db.insert(schema.user).values({ id: 'bill-1', email: 'bill@test.local', usagePeriodStart: new Date('2026-01-01T00:00:00Z') });

  check(await deliver('checkout.session.completed', {}, { secret: 'whsec_wrong' }) === 400, 'a wrongly signed event is refused');
  const unsigned = await POST(new Request('http://x', { method: 'POST', body: '{}' }));
  check(unsigned.status === 400, 'an unsigned event is refused');

  // Bank debit: checkout completes, money not yet in.
  const session = { id: 'cs_1', object: 'checkout.session', client_reference_id: 'bill-1', customer: 'cus_1', subscription: 'sub_1', payment_status: 'unpaid', metadata: { userId: 'bill-1', tier: 'creator' } };
  subs.set('sub_1', sub('sub_1', 'incomplete'));
  check(await deliver('checkout.session.completed', session) === 200, 'checkout with payment pending is acknowledged');
  let u = await userRow();
  check(u.stripeCustomerId === 'cus_1' && u.subscriptionTier === 'free', 'payment pending: customer stored, plan not granted');

  subs.set('sub_1', sub('sub_1', 'active'));
  await deliver('checkout.session.async_payment_succeeded', { ...session, payment_status: 'paid' });
  u = await userRow();
  check(u.subscriptionTier === 'creator' && u.usagePeriodStart > new Date('2026-06-01'), 'payment arrives: Creator granted and a fresh usage window started');

  const windowStart = u.usagePeriodStart.getTime();
  await new Promise((r) => setTimeout(r, 20));
  await deliver('checkout.session.async_payment_succeeded', { ...session, payment_status: 'paid' });
  await deliver('customer.subscription.updated', sub('sub_1', 'active'));
  u = await userRow();
  check(u.subscriptionTier === 'creator' && u.usagePeriodStart.getTime() === windowStart, 'duplicate deliveries change nothing (usage window not reset again)');

  // Upgrade through the portal: the subscription now has the Agency price.
  subs.set('sub_1', sub('sub_1', 'active', 'price_agency_y'));
  await deliver('customer.subscription.updated', sub('sub_1', 'active', 'price_creator_m'));
  check((await userRow()).subscriptionTier === 'agency', "the tier follows the subscription's current price, not the event's snapshot");

  // Cancelled; then a stale "active" event arrives late.
  subs.set('sub_1', sub('sub_1', 'canceled', 'price_agency_y'));
  await deliver('customer.subscription.deleted', sub('sub_1', 'canceled', 'price_agency_y'));
  check((await userRow()).subscriptionTier === 'free', 'cancellation drops the user to Free');
  await deliver('customer.subscription.updated', sub('sub_1', 'active', 'price_agency_y'));
  check((await userRow()).subscriptionTier === 'free', 'a stale "active" event after cancellation does not re-grant the plan');

  stripeDown = true;
  check(await deliver('customer.subscription.updated', sub('sub_1', 'active')) === 500, 'when Stripe cannot be reached the handler answers 500, so Stripe retries');
  stripeDown = false;

  check(await deliver('invoice.paid', { id: 'in_1', object: 'invoice' }) === 200, 'other event types are acknowledged');

  // ---- the live site never sells a plan for a test card ----
  const { billingEnabled } = await import('../src/lib/billing/stripe.ts');
  const { POST: checkout } = await import('../src/app/api/billing/checkout/route.ts');
  process.env.VERCEL_ENV = 'production';
  subs.set('sub_2', sub('sub_2', 'active'));
  const paid = { ...session, id: 'cs_2', subscription: 'sub_2', payment_status: 'paid' };
  check(await deliver('checkout.session.completed', paid, { livemode: false }) === 200, 'live site: a test-mode payment is acknowledged');
  check((await userRow()).subscriptionTier === 'free', 'live site: a test-mode payment grants nothing');
  await deliver('checkout.session.completed', paid, { livemode: true });
  check((await userRow()).subscriptionTier === 'creator', 'live site: a live payment grants the plan');
  await db.update(schema.user).set({ subscriptionTier: 'free' }).where(eq(schema.user.id, 'bill-1'));
  process.env.STRIPE_ALLOW_TEST_MODE = '1';
  await deliver('checkout.session.completed', paid, { livemode: false });
  check((await userRow()).subscriptionTier === 'creator', 'STRIPE_ALLOW_TEST_MODE=1 lets a deliberate staging site accept test payments');
  delete process.env.STRIPE_ALLOW_TEST_MODE;

  check(billingEnabled() === false, 'live site with a test key: paid plans are closed');
  const refused = await checkout(new Request('http://x/api/billing/checkout', { method: 'POST', body: JSON.stringify({ tier: 'creator' }) }));
  const refusedBody = await refused.json();
  check(refused.status === 503 && /coming soon/i.test(refusedBody.message), `live site with a test key: checkout refuses (${refused.status}: ${refusedBody.message})`);
  process.env.STRIPE_SECRET_KEY = 'sk_live_dummy';
  check(billingEnabled() === true, 'live site with a live key: paid plans are open');
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  delete process.env.VERCEL_ENV;
  check(billingEnabled() === true, 'previews and local runs keep test mode for testing');
} catch (e) {
  check(false, `unexpected error: ${e.stack}`);
} finally {
  await db.delete(schema.user).where(eq(schema.user.id, 'bill-1')).catch(() => undefined);
  await pool.end();
  server.close();
}

console.log(failed ? `\nBILLING: ${failed} FAILED` : '\nBILLING: ALL PASS');
process.exit(failed ? 1 : 0);
