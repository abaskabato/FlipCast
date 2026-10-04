import { Check, Minus } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { SiteFooter } from './site-chrome';
import { SiteHeader } from './site-header';

/** A row of the comparison table: what Flipcast does, and what the other tool does. */
export type CompareRow = { feature: string; us: string; them: string; usWins?: boolean };

/**
 * Shared layout for search-landing pages ("Opus Clip alternative", "podcast
 * clip maker"): a pitch, an honest comparison, when the other tool is the
 * better pick, and questions. Static, so it renders at build time.
 */
export function ComparePage({
  eyebrow,
  title,
  intro,
  them,
  rows,
  checked,
  betterElsewhere,
  steps,
  faq,
}: {
  eyebrow: string;
  title: ReactNode;
  intro: string;
  /** Column heading for the other tool; omit to show Flipcast alone. */
  them?: string;
  rows: CompareRow[];
  /** Where and when the comparison was checked. */
  checked?: ReactNode;
  betterElsewhere?: { heading: string; points: string[] };
  steps: { title: string; body: string }[];
  faq: { q: string; a: string }[];
}) {
  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-5xl px-1 py-2 sm:px-2">
        <SiteHeader />

        <section className="mx-auto mt-14 max-w-3xl text-center">
          <p className="fc-chip-accent mx-auto inline-flex">{eyebrow}</p>
          <h1 className="fc-display mt-5 text-4xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-6xl">{title}</h1>
          <p className="fc-body mx-auto mt-5 max-w-2xl text-base sm:text-lg">{intro}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/#studio" className="fc-btn-primary">
              Try it free, no card
            </Link>
            <Link href="/pricing" className="fc-btn-secondary">
              See pricing
            </Link>
          </div>
        </section>

        <section className="fc-card mt-14 overflow-x-auto p-5 sm:p-6">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="fc-meta">
                <th className="py-2 pr-3 font-medium">
                  <span className="sr-only">Feature</span>
                </th>
                <th className="py-2 pr-3 font-semibold text-white">Flipcast</th>
                {them && <th className="py-2 font-semibold text-zinc-300">{them}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.feature} className="border-t border-white/[0.06] align-top">
                  <td className="py-3 pr-3 font-medium text-zinc-200">{r.feature}</td>
                  <td className="py-3 pr-3 text-zinc-100">
                    <span className="inline-flex gap-2">
                      {r.usWins ? (
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      ) : (
                        <Minus className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
                      )}
                      {r.us}
                    </span>
                  </td>
                  {them && <td className="py-3 text-zinc-400">{r.them}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {checked && <p className="fc-meta mt-4">{checked}</p>}
        </section>

        {betterElsewhere && (
          <section className="fc-card mt-6 p-5 sm:p-6">
            <h2 className="fc-heading">{betterElsewhere.heading}</h2>
            <ul className="mt-3 space-y-2">
              {betterElsewhere.points.map((p) => (
                <li key={p} className="fc-body flex gap-2.5">
                  <Minus className="mt-1 h-4 w-4 shrink-0 text-zinc-500" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-14">
          <h2 className="fc-display text-center text-3xl font-bold text-white">How it works</h2>
          <ol className="mt-6 grid gap-3 md:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.title} className="fc-card p-5">
                <p className="fc-meta font-mono">0{i + 1}</p>
                <p className="fc-heading mt-1">{s.title}</p>
                <p className="fc-body mt-1.5">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto mt-14 max-w-3xl">
          <h2 className="fc-display text-center text-3xl font-bold text-white">Questions</h2>
          <div className="mt-6 space-y-2">
            {faq.map((f) => (
              <details key={f.q} className="fc-card group p-5">
                <summary className="cursor-pointer list-none font-semibold text-white">{f.q}</summary>
                <p className="fc-body mt-2">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mt-14 text-center">
          <Link href="/#studio" className="fc-btn-primary">
            Make your first clip
          </Link>
        </section>

        <SiteFooter />
      </div>
    </main>
  );
}
