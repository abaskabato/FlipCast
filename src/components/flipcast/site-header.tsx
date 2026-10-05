'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, CreditCard, LogOut, UserRound } from 'lucide-react';

import { authClient, useSession } from '@/lib/auth-client';
import { LogoMark } from './logo-mark';

type SessionUser = { name?: string | null; email: string; image?: string | null };

/** What to call someone: their name, else the part of their email before the @. */
export function displayName(user: SessionUser): string {
  return user.name?.trim() || user.email.split('@')[0];
}

/** Profile photo, or initials on the brand gradient when there is none. */
export function Avatar({ user, size = 36 }: { user: SessionUser; size?: number }) {
  const name = displayName(user);
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return user.image ? (
    // eslint-disable-next-line @next/next/no-img-element -- data: URLs and tiny sizes
    <img
      src={user.image}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-full object-cover ring-2 ring-white/10"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden="true"
      className="fc-gradient fc-display flex shrink-0 items-center justify-center rounded-full font-bold text-white ring-2 ring-white/10"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials || '?'}
    </span>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="Flipcast home">
      <LogoMark size={36} className="shrink-0 rounded-[8px] shadow-lg shadow-pink-500/30" />
      <span className="fc-display text-xl font-extrabold tracking-tight text-white">Flipcast</span>
    </Link>
  );
}

function UserMenu({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item =
    'flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.06]';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex min-h-[44px] items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-1 pr-3 transition-colors hover:bg-white/[0.08]"
      >
        <Avatar user={user} size={34} />
        <span className="hidden max-w-[10rem] truncate text-sm font-semibold text-white sm:inline">
          {displayName(user)}
        </span>
        <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 rounded-2xl border border-white/10 bg-[rgb(var(--fc-surface))] p-1.5 shadow-2xl shadow-black/50"
        >
          <div className="flex items-center gap-3 px-3 py-3">
            <Avatar user={user} size={40} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{displayName(user)}</p>
              <p className="truncate text-xs text-zinc-500">{user.email}</p>
            </div>
          </div>
          <div className="my-1 h-px bg-white/[0.06]" />
          <Link href="/account" role="menuitem" className={item} onClick={() => setOpen(false)}>
            <UserRound className="h-4 w-4 text-zinc-400" />
            Profile & account
          </Link>
          <Link href="/account#plan" role="menuitem" className={item} onClick={() => setOpen(false)}>
            <CreditCard className="h-4 w-4 text-zinc-400" />
            Plan & billing
          </Link>
          <div className="my-1 h-px bg-white/[0.06]" />
          <button
            role="menuitem"
            className={`${item} hover:!text-red-300`}
            onClick={async () => {
              await authClient.signOut();
              window.location.href = '/';
            }}
          >
            <LogOut className="h-4 w-4 text-zinc-400" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The one header for every page. `onSignIn` lets the home page focus its
 * inline sign-in form; elsewhere the button links there.
 */
export function SiteHeader({ onSignIn }: { onSignIn?: () => void }) {
  const { data: session, isPending } = useSession();
  const user = session?.user;

  return (
    <header className="flex items-center justify-between gap-4">
      <Logo />
      <nav className="flex items-center gap-1 sm:gap-2" aria-label="Main">
        {/* Section links on wider screens; phones keep the header to the essentials. */}
        <Link href="/#features" className="fc-btn-ghost hidden !text-sm md:inline-flex">
          Features
        </Link>
        <Link href="/#use-cases" className="fc-btn-ghost hidden !text-sm md:inline-flex">
          Use cases
        </Link>
        <Link href="/opus-clip-alternative" className="fc-btn-ghost hidden !text-sm lg:inline-flex">
          vs Opus Clip
        </Link>
        <Link href="/pricing" className="fc-btn-ghost !text-sm">
          Pricing
        </Link>
        {user ? (
          <UserMenu user={user} />
        ) : (
          !isPending &&
          (onSignIn ? (
            <button onClick={onSignIn} className="fc-btn-primary !min-h-[40px] !px-4">
              Sign in
            </button>
          ) : (
            <Link href="/#account" className="fc-btn-primary !min-h-[40px] !px-4">
              Sign in
            </Link>
          ))
        )}
      </nav>
    </header>
  );
}
