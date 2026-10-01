import type { Metadata } from 'next';
import Link from 'next/link';

import { formatQuota, TIER_LIMITS, TIER_PRICE_LABEL } from '@/lib/quotas';

/**
 * Public pricing page.
 *
 * Static by design: it renders at build time and needs no database, auth or
 * Stripe client, so it cannot fail on a cold serverless start.
 *
 * Prices are shown as the *intended* price and flagged as such, because
 * `STRIPE_PRICE_*` IDs carry no amount -- the real number lives in the Stripe
 * dashboard. Checkout enforces the actual price; this page must never be
 * authoritative.
 */

export const metadata: Metadata = {
  title: 'Pricing — Flipcast',
  description:
    'Render vertical, square and landscape cuts from one video, in your browser. Free tier needs no card.',
};

type PlanCopy = {
  id: 'free' | 'creator' | 'agency';
  price: string;
  cadence: string;
  highlights: string[];
  cta: string;
  featured?: boolean;
};

const PLANS: PlanCopy[] = [
  {
    id: 'free',
    price: '$0',
    cadence: 'forever',
    highlights: [
      `${formatQuota(TIER_LIMITS.free)} of source video per month`,
      'Up to 3 minutes per clip',
      'Every output format',
      'Renders on your device — nothing uploaded',
      'No card required',
    ],
    cta: 'Start rendering',
  },
  {
    id: 'creator',
    price: '$12',
    cadence: 'per month',
    highlights: [
      `${formatQuota(TIER_LIMITS.creator)} of source video per month`,
      'Up to 15 minutes per clip',
      'Everything in Free',
      'Priority support',
    ],
    cta: 'Choose Creator',
    featured: true,
  },
  {
    id: 'agency',
    price: '$39',
    cadence: 'per month',
    highlights: [
      `${formatQuota(TIER_LIMITS.agency)} of source video per month`,
      'Up to 60 minutes per clip',
      'Everything in Creator',
      'Team billing',
    ],
    cta: 'Choose Agency',
  },
];

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-slate-950 px-5 py-16 text-slate-100">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <Link href="/" className="text-sm font-semibold text-indigo-400 hover:text-indigo-300">
            ← Back to Flipcast
          </Link>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-white">
            Every format, from one upload
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-slate-400">
            Flipcast renders 9:16, 1:1 and 16:9 cuts in your browser. Your footage is never
            uploaded, so there is no per-minute processing bill to pass on to you.
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`flex flex-col rounded-2xl border p-6 ${
                plan.featured
                  ? 'border-indigo-500 bg-indigo-500/5 shadow-lg shadow-indigo-500/10'
                  : 'border-slate-800 bg-slate-900'
              }`}
            >
              <p className="text-sm font-semibold text-slate-300">
                {TIER_PRICE_LABEL[plan.id]}
              </p>
              <p className="mt-3 flex items-baseline gap-1.5">
                <span className="text-4xl font-bold text-white">{plan.price}</span>
                <span className="text-xs text-slate-500">{plan.cadence}</span>
              </p>

              <ul className="mt-5 flex-1 space-y-2.5">
                {plan.highlights.map((h) => (
                  <li key={h} className="flex gap-2 text-sm text-slate-300">
                    <span className="mt-0.5 text-emerald-400">✓</span>
                    <span>{h}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={plan.id === 'free' ? '/' : `/?plan=${plan.id}#upgrade`}
                className={`mt-6 rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition-colors ${
                  plan.featured
                    ? 'bg-indigo-500 text-white hover:bg-indigo-400'
                    : 'border border-slate-700 text-slate-200 hover:bg-slate-800'
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>

        <p className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-center text-xs text-amber-200/90">
          Paid plans are not switched on yet. Until checkout is enabled the free tier is
          unlimited to sign up for, and no card is ever required.
        </p>

        <section className="mt-14 grid gap-6 sm:grid-cols-3">
          <div>
            <h2 className="text-sm font-bold text-white">Why it&apos;s fast enough</h2>
            <p className="mt-1.5 text-sm text-slate-400">
              Encoding runs in your tab with multi-threaded FFmpeg, so there is no queue and no
              cold start.
            </p>
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Why it&apos;s private</h2>
            <p className="mt-1.5 text-sm text-slate-400">
              The video never leaves your device. Only job metadata — duration, format, size —
              reaches the server.
            </p>
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">What counts as usage</h2>
            <p className="mt-1.5 text-sm text-slate-400">
              We charge for seconds of your source video, not exports. One clip exported to
              three formats costs the same as one.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
