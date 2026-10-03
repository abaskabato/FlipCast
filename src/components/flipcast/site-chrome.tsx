import Link from 'next/link';

import { SUPPORT_EMAIL } from '@/lib/site';

/** One footer for every page, so legal links are always one click away. */
export function SiteFooter() {
  const links = [
    { href: '/pricing', label: 'Pricing' },
    { href: '/terms', label: 'Terms' },
    { href: '/privacy', label: 'Privacy' },
  ];
  return (
    <footer className="mt-16 flex flex-col items-center gap-2 border-t border-white/[0.06] pb-4 pt-6 text-center">
      <nav className="flex flex-wrap items-center justify-center gap-x-4">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="fc-link !text-zinc-400 hover:!text-zinc-200">
            {l.label}
          </Link>
        ))}
        {SUPPORT_EMAIL && (
          <a href={`mailto:${SUPPORT_EMAIL}`} className="fc-link !text-zinc-400 hover:!text-zinc-200">
            Support
          </a>
        )}
      </nav>
      <p className="fc-meta">Flipcast · renders run in your browser, nothing is uploaded</p>
    </footer>
  );
}
