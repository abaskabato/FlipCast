'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

import { checkoutIntentUrl, startCheckout } from '@/lib/billing/client';
import {
  formatPrice,
  perMonth,
  PLAN_PRICES,
  type BillingPeriod,
  type PaidTier,
} from '@/lib/billing/plans';
import { formatQuota, MAX_SOURCE_SECONDS, TIER_LIMITS } from '@/lib/quotas';

type Plan = {
  id: 'free' | PaidTier;
  name: string;
  blurb: string;
  highlights: string[];
  featured?: boolean;
};

const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    blurb: 'Try it on real footage.',
    highlights: [
      `${formatQuota(TIER_LIMITS.free)} of source video a month`,
      `Clips up to ${MAX_SOURCE_SECONDS.free / 60} minutes`,
      'Auto-track and word-by-word auto captions',
      'All three formats, no watermark',
      'No card required',
    ],
  },
  {
    id: 'creator',
    name: 'Creator',
    blurb: 'For posting every day.',
    highlights: [
      `${formatQuota(TIER_LIMITS.creator)} of source video a month`,
      `Clips up to ${MAX_SOURCE_SECONDS.creator / 60} minutes`,
      'About 4¢ a minute, a fraction of cloud tools',
      'Everything in Free',
    ],
    featured: true,
  },
  {
    id: 'agency',
    name: 'Agency',
    blurb: 'For shipping client work in bulk.',
    highlights: [
      `${formatQuota(TIER_LIMITS.agency)} of source video a month`,
      `Clips up to ${MAX_SOURCE_SECONDS.agency / 60} minutes`,
      'Everything in Creator',
    ],
  },
];

export default function PricingPlans({ billingEnabled }: { billingEnabled: boolean }) {
  const [period, setPeriod] = useState<BillingPeriod>('monthly');
  const [busy, setBusy] = useState<PaidTier | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const choose = async (tier: PaidTier) => {
    setBusy(tier);
    setMessage(null);
    const outcome = await startCheckout(tier, period);
    if (outcome.kind === 'signin') {
      window.location.href = checkoutIntentUrl(tier, period);
      return;
    }
    if (outcome.kind === 'message') setMessage(outcome.message);
    setBusy(null);
  };

  return (
    <div className="mt-10">
      <div className="flex justify-center">
        <div
          role="radiogroup"
          aria-label="Billing period"
          className="inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1"
        >
          {(['monthly', 'yearly'] as const).map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={period === p}
              onClick={() => setPeriod(p)}
              className={`min-h-[40px] rounded-full px-4 text-sm font-semibold transition-colors ${
                period === p ? 'bg-white/[0.12] text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {p === 'monthly' ? 'Monthly' : 'Yearly'}
              {p === 'yearly' && (
                <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
                  2 months free
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {message && (
        <p role="alert" className="fc-notice-warn mx-auto mt-6 max-w-xl">
          {message}
        </p>
      )}

      <div className="mt-8 grid items-stretch gap-5 md:grid-cols-3">
        {PLANS.map((plan) => {
          const paid = plan.id !== 'free';
          const monthlyCents = paid ? perMonth(plan.id as PaidTier, period) : 0;
          return (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-3xl border p-6 ${
                plan.featured
                  ? 'border-pink-400/60 bg-gradient-to-b from-pink-500/[0.12] via-fuchsia-500/[0.05] to-transparent shadow-xl shadow-pink-500/15'
                  : 'border-white/[0.07] bg-[rgb(var(--fc-surface))]'
              }`}
            >
              {plan.featured && (
                <span className="absolute -top-3 left-6 fc-gradient rounded-full px-3 py-1 text-xs font-semibold text-white">
                  Most popular
                </span>
              )}
              <p className="fc-display text-xl font-bold text-white">{plan.name}</p>
              <p className="fc-body mt-1">{plan.blurb}</p>

              <p className="mt-5 flex items-baseline gap-1.5">
                <span className="fc-display text-5xl font-extrabold tracking-tight text-white">
                  {formatPrice(monthlyCents)}
                </span>
                <span className="text-sm text-zinc-400">{paid ? '/ month' : 'forever'}</span>
              </p>
              <p className="fc-meta mt-1 h-5">
                {paid && period === 'yearly'
                  ? `${formatPrice(PLAN_PRICES[plan.id as PaidTier].yearly)} billed yearly`
                  : paid
                    ? 'Billed monthly, cancel any time'
                    : ''}
              </p>

              <ul className="mt-6 flex-1 space-y-3">
                {plan.highlights.map((h) => (
                  <li key={h} className="flex gap-2.5 text-sm text-zinc-300">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>

              {!paid ? (
                <Link href="/" className="fc-btn-secondary mt-8 w-full">
                  Start rendering
                </Link>
              ) : billingEnabled ? (
                <button
                  onClick={() => void choose(plan.id as PaidTier)}
                  disabled={busy !== null}
                  className={`mt-8 w-full ${plan.featured ? 'fc-btn-primary' : 'fc-btn-secondary'}`}
                >
                  {busy === plan.id ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Opening checkout…
                    </>
                  ) : (
                    `Choose ${plan.name}`
                  )}
                </button>
              ) : (
                <button disabled className="fc-btn-secondary mt-8 w-full">
                  Coming soon
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
