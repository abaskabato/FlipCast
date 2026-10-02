import type { Metadata } from 'next';
import Link from 'next/link';

import PricingPlans from '@/components/flipcast/pricing-plans';
import { SiteFooter } from '@/components/flipcast/site-chrome';

/**
 * Public pricing page.
 *
 * Static: it renders at build time and needs no database, auth or Stripe call,
 * so it cannot fail on a cold serverless start. Whether checkout is switched on
 * is read from the env at build, which is also when Vercel applies env changes.
 */

export const metadata: Metadata = {
  title: 'Pricing — Flipcast',
  description:
    'Render vertical, square and landscape cuts from one video, in your browser. Free tier needs no card.',
};

const billingEnabled = Boolean(
  process.env.STRIPE_SECRET_KEY?.trim() && process.env.STRIPE_PRICE_CREATOR_MONTHLY?.trim(),
);

const FAQ = [
  {
    q: 'What counts toward my minutes?',
    a: 'Seconds of the video you put in, not what comes out. One clip exported to all three formats costs the same as one format.',
  },
  {
    q: 'Why is it cheaper than cloud tools?',
    a: 'Rendering happens on your own device, so there is no upload, no render farm and no storage bill for us to pass on.',
  },
  {
    q: 'Can I cancel?',
    a: 'Any time, from “Manage billing”. You keep your plan until the end of the period you paid for.',
  },
  {
    q: 'Is my footage private?',
    a: 'Yes. Videos never leave your browser. Only details like duration and format reach our server.',
  },
];

export default function PricingPage() {
  return (
    <main className="min-h-screen px-5 pb-8 pt-12 text-slate-100">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <Link href="/" className="fc-link mx-auto">
            ← Back to Flipcast
          </Link>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Simple pricing, private by design
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-400">
            Pay for the minutes of footage you reframe. Every plan gets every format, and your
            video never leaves your device.
          </p>
        </div>

        <PricingPlans billingEnabled={billingEnabled} />

        <section className="mx-auto mt-16 max-w-3xl">
          <h2 className="text-center text-xl font-semibold text-white">Questions</h2>
          <dl className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2">
            {FAQ.map(({ q, a }) => (
              <div key={q}>
                <dt className="fc-heading">{q}</dt>
                <dd className="fc-body mt-1.5">{a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <SiteFooter />
      </div>
    </main>
  );
}
