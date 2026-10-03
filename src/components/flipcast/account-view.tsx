'use client';

import {
  AuthUIProvider,
  ChangeEmailCard,
  ChangePasswordCard,
  DeleteAccountCard,
  SessionsCard,
  UpdateAvatarCard,
  UpdateNameCard,
  authLocalization,
  type SettingsCardClassNames,
} from '@daveyplate/better-auth-ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import {
  ArrowRight,
  CalendarDays,
  CreditCard,
  Film,
  Loader2,
  ShieldCheck,
  Sparkles,
  Share2,
  Trash2,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

import { authClient, useSession } from '@/lib/auth-client';
import { openBillingPortal } from '@/lib/billing/client';
import { formatDuration, formatQuota } from '@/lib/quotas';
import { formatBytes } from '@/lib/video/probe';
import { Avatar, displayName, SiteHeader } from './site-header';
import { SiteFooter } from './site-chrome';
import ConnectionsPanel from './connections-panel';

const AUTH_LOCALIZATION = authLocalization as unknown as Record<string, unknown>;

type Usage = {
  tier: string;
  tierLabel?: string;
  usedSeconds: number;
  limitSeconds: number;
  remainingSeconds: number;
  periodStart?: string;
  maxSourceSeconds?: number;
};

type Job = {
  id: string;
  originalName: string;
  status: string;
  trackingMode: string;
  sourceDurationSeconds: number | null;
  createdAt: string;
  outputs: { id: string; ratio: string; status: string; sizeBytes: number | null }[];
};

/** Settings cards come from better-auth-ui; these bring them onto the app's surfaces. */
const CARD: SettingsCardClassNames = {
  base: 'rounded-3xl border-white/[0.07] bg-[rgb(var(--fc-surface))] shadow-none overflow-hidden',
  header: 'pb-2',
  title: 'fc-display text-lg font-bold tracking-tight',
  description: 'text-sm text-zinc-400',
  footer: 'border-white/[0.06] bg-white/[0.02]',
  input: 'min-h-[44px] rounded-xl text-sm',
  primaryButton: 'min-h-[40px] rounded-full px-5 text-sm font-semibold',
  outlineButton: 'min-h-[40px] rounded-full text-sm',
  destructiveButton: 'min-h-[40px] rounded-full px-5 text-sm font-semibold',
  instructions: 'text-xs text-zinc-500',
  avatar: { fallback: 'fc-gradient fc-display font-bold text-white' },
};

const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'profile', label: 'Profile', icon: UserRound },
  { id: 'plan', label: 'Plan & billing', icon: CreditCard },
  { id: 'connections', label: 'Connections', icon: Share2 },
  { id: 'history', label: 'Render history', icon: Film },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'danger', label: 'Delete account', icon: Trash2 },
];

const RATIO_STYLE: Record<string, string> = {
  '9:16': 'border-pink-500/30 bg-pink-500/10 text-pink-300',
  '1:1': 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  '16:9': 'border-orange-500/30 bg-orange-500/10 text-orange-300',
};

function SectionTitle({ id, title, subtitle }: { id: string; title: string; subtitle: string }) {
  return (
    <div id={id} className="scroll-mt-24 pt-2">
      <h2 className="fc-display text-2xl font-bold tracking-tight text-white">{title}</h2>
      <p className="fc-body mt-1">{subtitle}</p>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
      <p className="fc-display text-2xl font-bold text-white">{value}</p>
      <p className="fc-meta">{label}</p>
    </div>
  );
}

export default function AccountView() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const user = session?.user;

  const [usage, setUsage] = useState<Usage | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingMessage, setBillingMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isPending && !user) router.replace('/#account');
  }, [isPending, user, router]);

  useEffect(() => {
    if (!user) return;
    void fetch('/api/me/usage')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setUsage(d))
      .catch(() => undefined);
    void fetch('/api/jobs')
      .then((r) => (r.ok ? r.json() : { jobs: [] }))
      .then((d) => setJobs(d.jobs ?? []))
      .catch(() => setJobs([]));
  }, [user]);

  // Deleting the account or revoking this session sends the library to its
  // own sign-out route, which this app does not mount. Finish it here instead.
  const navigate = useCallback(
    (href: string) => {
      if (href.endsWith('/sign-out')) {
        void authClient.signOut().finally(() => {
          window.location.href = '/';
        });
        return;
      }
      router.push(href);
    },
    [router],
  );

  const manageBilling = async () => {
    setBillingBusy(true);
    setBillingMessage(null);
    const outcome = await openBillingPortal('/account');
    if (outcome.kind === 'message') setBillingMessage(outcome.message);
    if (outcome.kind !== 'redirected') setBillingBusy(false);
  };

  if (!user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-pink-400" />
      </div>
    );
  }

  const completed = (jobs ?? []).filter((j) => j.status === 'completed');
  const clipCount = completed.reduce((n, j) => n + j.outputs.length, 0);
  const usagePercent = usage
    ? Math.min(100, (usage.usedSeconds / Math.max(1, usage.limitSeconds)) * 100)
    : 0;
  const tierName = usage?.tierLabel ?? (usage ? usage.tier[0].toUpperCase() + usage.tier.slice(1) : '');
  const memberSince = new Date(user.createdAt).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  return (
    <AuthUIProvider
      authClient={authClient}
      navigate={navigate}
      replace={(href) => router.replace(href)}
      onSessionChange={() => router.refresh()}
      Link={Link}
      redirectTo="/"
      avatar
      changeEmail
      deleteUser
      emailVerification={false}
      credentials={{ forgotPassword: false }}
    >
      <Toaster theme="dark" position="bottom-center" richColors />
      <div className="mx-auto max-w-6xl space-y-8 px-1 py-2 sm:px-2">
        <SiteHeader />

        {/* Profile header, styled like a creator profile: cover, photo, name, stats. */}
        <section className="fc-card overflow-hidden">
          <div className="fc-gradient relative h-28 sm:h-36">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_120%,rgb(0_0_0/0.35),transparent_60%)]" />
          </div>
          <div className="px-5 pb-6 sm:px-8">
            <div className="-mt-12 flex flex-wrap items-end justify-between gap-4">
              <div className="relative z-10 rounded-full bg-[rgb(var(--fc-surface))] p-1.5">
                <Avatar user={user} size={96} />
              </div>
              <Link href="/" className="fc-btn-primary">
                <Sparkles className="h-4 w-4" />
                New flip
              </Link>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="fc-display text-3xl font-extrabold tracking-tight text-white">
                {displayName(user)}
              </h1>
              {usage && <span className="fc-chip-accent">{tierName} plan</span>}
            </div>
            <p className="mt-1 text-sm text-zinc-400">{user.email}</p>
            <p className="fc-meta mt-1 flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" />
              Creating since {memberSince}
            </p>

            <div className="mt-6 grid grid-cols-3 gap-3 sm:max-w-lg">
              <Stat value={jobs ? String(completed.length) : '–'} label="videos flipped" />
              <Stat value={jobs ? String(clipCount) : '–'} label="clips made" />
              <Stat value={usage ? formatQuota(usage.usedSeconds) : '–'} label="used this month" />
            </div>
          </div>
        </section>

        <div className="grid items-start gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
          {/* Section nav: a sticky list on desktop, a scrolling pill row on mobile. */}
          <nav
            aria-label="Account sections"
            className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:sticky lg:top-6 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0"
          >
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <a
                key={id}
                href={`#${id}`}
                className={`flex min-h-[40px] shrink-0 items-center gap-2.5 rounded-full px-4 text-sm font-medium transition-colors hover:bg-white/[0.06] lg:rounded-xl ${
                  id === 'danger' ? 'text-zinc-500 hover:text-red-300' : 'text-zinc-300 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </a>
            ))}
          </nav>

          <div className="min-w-0 space-y-6">
            <SectionTitle
              id="profile"
              title="Profile"
              subtitle="How you show up in Flipcast. Your photo and name appear in the header."
            />
            <UpdateAvatarCard classNames={CARD} localization={AUTH_LOCALIZATION} />
            <UpdateNameCard classNames={CARD} localization={AUTH_LOCALIZATION} />
            <ChangeEmailCard classNames={CARD} localization={AUTH_LOCALIZATION} />

            <SectionTitle
              id="plan"
              title="Plan & billing"
              subtitle="Your monthly render allowance, and where to change or cancel your plan."
            />
            <div className="fc-card space-y-5 p-6">
              {usage ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="fc-meta">Current plan</p>
                      <p className="fc-display mt-0.5 text-2xl font-bold text-white">{tierName}</p>
                      {usage.maxSourceSeconds && (
                        <p className="fc-meta mt-1">
                          Clips up to {Math.round(usage.maxSourceSeconds / 60)} min each
                        </p>
                      )}
                    </div>
                    {usage.tier === 'free' ? (
                      <Link href="/pricing" className="fc-btn-primary">
                        Upgrade
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    ) : (
                      <button
                        onClick={() => void manageBilling()}
                        disabled={billingBusy}
                        className="fc-btn-secondary"
                      >
                        {billingBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <CreditCard className="h-4 w-4" />
                        )}
                        Manage billing
                      </button>
                    )}
                  </div>

                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-white">
                        {formatQuota(usage.usedSeconds)} used
                      </span>
                      <span className="fc-meta">of {formatQuota(usage.limitSeconds)} this month</span>
                    </div>
                    <div
                      className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]"
                      role="progressbar"
                      aria-valuenow={Math.round(usagePercent)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="Monthly render time used"
                    >
                      <div
                        className={`h-full rounded-full ${usagePercent >= 90 ? 'bg-amber-400' : 'fc-gradient'}`}
                        style={{ width: `${usagePercent}%` }}
                      />
                    </div>
                    <p className="fc-meta mt-2">
                      {formatQuota(usage.remainingSeconds)} left · resets at the start of each month
                    </p>
                  </div>

                  {usage.tier !== 'free' && (
                    <p className="fc-meta">
                      Change plan, update your card, download invoices or cancel in the billing
                      portal.
                    </p>
                  )}
                  {billingMessage && <p className="fc-notice-warn">{billingMessage}</p>}
                </>
              ) : (
                <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
              )}
            </div>

            <SectionTitle
              id="connections"
              title="Connections"
              subtitle="YouTube channels and TikTok accounts you can publish to, and what you have posted or scheduled."
            />
            <ConnectionsPanel />

            <SectionTitle
              id="history"
              title="Render history"
              subtitle="What you've made. Videos stay on your device, so this lists the renders, not the files."
            />
            <div className="fc-card p-2">
              {jobs === null ? (
                <div className="p-4">
                  <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
                </div>
              ) : jobs.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                  <p className="text-sm font-semibold text-white">No renders yet</p>
                  <p className="fc-body">Your first flip will show up here.</p>
                  <Link href="/" className="fc-btn-primary mt-1">
                    Flip a video
                  </Link>
                </div>
              ) : (
                <ul className="divide-y divide-white/[0.05]">
                  {jobs.map((job) => (
                    <li key={job.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">{job.originalName}</p>
                        <p className="fc-meta">
                          {new Date(job.createdAt).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                          {job.sourceDurationSeconds != null &&
                            ` · ${formatDuration(job.sourceDurationSeconds)}`}
                          {job.outputs.some((o) => o.sizeBytes) &&
                            ` · ${formatBytes(job.outputs.reduce((n, o) => n + (o.sizeBytes ?? 0), 0))}`}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {job.outputs.map((o) => (
                          <span
                            key={o.id}
                            className={`rounded-full border px-2 py-0.5 font-mono text-xs font-semibold ${RATIO_STYLE[o.ratio] ?? 'border-white/10 text-zinc-400'}`}
                          >
                            {o.ratio}
                          </span>
                        ))}
                      </div>
                      <span
                        className={`w-20 text-right text-xs font-semibold capitalize ${
                          job.status === 'completed'
                            ? 'text-emerald-400'
                            : job.status === 'failed'
                              ? 'text-red-400'
                              : 'text-zinc-500'
                        }`}
                      >
                        {job.status === 'canceled' ? 'cancelled' : job.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <SectionTitle
              id="security"
              title="Security"
              subtitle="Your password, and the devices signed in to your account."
            />
            <ChangePasswordCard classNames={CARD} localization={AUTH_LOCALIZATION} />
            <SessionsCard classNames={CARD} localization={AUTH_LOCALIZATION} />

            <SectionTitle
              id="danger"
              title="Delete account"
              subtitle="Permanently removes your account and render history, and cancels any paid plan immediately."
            />
            <DeleteAccountCard
              classNames={{ ...CARD, base: `${CARD.base} border-red-500/25` }}
              localization={AUTH_LOCALIZATION}
            />
          </div>
        </div>

        <SiteFooter />
      </div>
    </AuthUIProvider>
  );
}
