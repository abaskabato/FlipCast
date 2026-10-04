import type { Metadata } from 'next';

import PricingPlans from '@/components/flipcast/pricing-plans';
import { SiteFooter } from '@/components/flipcast/site-chrome';
import { SiteHeader } from '@/components/flipcast/site-header';
import { billingEnabled } from '@/lib/billing/stripe';

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

// Off on the live site until a live Stripe key is set; see billingEnabled().
const paidPlansOpen = billingEnabled();

/** Checked against Opus Clip's public pricing page, 2026-10. Kept unnamed so it ages well. */
const GAP: [feature: string, elsewhere: string][] = [
  ['Rendering many clips at once', 'From $29/mo'],
  ['Your video stays on your device', 'Uploaded to their servers'],
  ['Captions without a watermark', 'Paid plans'],
  ['Exports that never expire', 'Deleted after 3 days on free'],
];

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
    q: 'Are captions and auto-track extra?',
    a: 'No. Every plan, including Free, gets word-by-word captions in three styles, an .srt file, and auto-track that keeps the speaker in frame. No watermark on any plan.',
  },
  {
    q: 'Can I cancel?',
    a: 'Any time, from “Manage billing”. You keep your plan until the end of the period you paid for.',
  },
  {
    q: 'Is my footage private?',
    a: 'Yes. Videos never leave your browser, and captions are transcribed on your device too. Only details like duration and format reach our server.',
  },
];

export default function PricingPage() {
  return (
    <main className="min-h-screen p-4 pb-8 text-zinc-100 md:p-8">
      <div className="mx-auto max-w-6xl px-1 py-2 sm:px-2">
        <SiteHeader />
        <div className="mt-12 text-center">
          <h1 className="fc-display text-5xl font-extrabold tracking-tight text-white sm:text-6xl">
            Post more. <span className="fc-gradient-text">Pay less.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-zinc-400">
            Hours of footage for less than cloud tools charge for minutes. Every plan gets auto
            captions, auto-track and every format, with no watermark, and your video never
            leaves your device.
          </p>
        </div>

        <PricingPlans billingEnabled={paidPlansOpen} />

        <section className="mx-auto mt-16 max-w-3xl">
          <h2 className="fc-display text-center text-3xl font-bold text-white">
            Paid elsewhere. <span className="fc-gradient-text">Free here.</span>
          </h2>
          <p className="fc-body mx-auto mt-2 max-w-xl text-center">
            Popular AI clipping tools keep these behind paid plans, some at $29 a month. On Flipcast
            they are in the free plan.
          </p>
          <div className="fc-card mt-6 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th scope="col" className="p-4 text-left font-medium text-zinc-500">
                    <span className="sr-only">Feature</span>
                  </th>
                  <th scope="col" className="w-32 p-4 text-center font-medium text-zinc-400 sm:w-44">
                    Elsewhere
                  </th>
                  <th scope="col" className="w-32 bg-pink-500/[0.06] p-4 text-center font-bold text-white sm:w-44">
                    Flipcast Free
                  </th>
                </tr>
              </thead>
              <tbody>
                {GAP.map(([feature, elsewhere]) => (
                  <tr key={feature} className="border-b border-white/[0.04] last:border-0">
                    <th scope="row" className="p-4 text-left font-medium text-zinc-200">
                      {feature}
                    </th>
                    <td className="p-4 text-center text-xs text-zinc-500">{elsewhere}</td>
                    <td className="bg-pink-500/[0.06] p-4 text-center font-semibold text-emerald-400">
                      Included
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mx-auto mt-16 max-w-3xl">
          <h2 className="fc-display text-center text-3xl font-bold text-white">Questions</h2>
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
