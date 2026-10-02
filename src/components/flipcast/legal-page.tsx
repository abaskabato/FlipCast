import Link from 'next/link';
import type { ReactNode } from 'react';

import { LEGAL_UPDATED, SUPPORT_EMAIL } from '@/lib/site';

/** Shared shell for /terms and /privacy: readable measure, one heading scale. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="min-h-screen px-5 py-12 text-slate-300">
      <article className="mx-auto max-w-2xl">
        <Link href="/" className="fc-link">
          ← Back to Flipcast
        </Link>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-white">{title}</h1>
        <p className="fc-meta mt-2">Last updated {LEGAL_UPDATED}</p>
        <div className="mt-8 space-y-6 text-sm leading-relaxed [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-white [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
          {children}
        </div>
      </article>
    </main>
  );
}

/** "email us at x" when a support address is configured, else a neutral line. */
export function ContactLine() {
  return SUPPORT_EMAIL ? (
    <>
      email{' '}
      <a href={`mailto:${SUPPORT_EMAIL}`} className="text-indigo-400 underline underline-offset-4">
        {SUPPORT_EMAIL}
      </a>
    </>
  ) : (
    <>contact us from the email address on your account</>
  );
}
