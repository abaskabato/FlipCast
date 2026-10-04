import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { SiteFooter } from '@/components/flipcast/site-chrome';
import { SiteHeader } from '@/components/flipcast/site-header';
import { getMetrics, isAdmin } from '@/lib/admin/metrics';
import { auth } from '@/lib/auth';

export const metadata: Metadata = { title: 'Metrics — Flipcast', robots: { index: false } };
// Always live numbers, never a cached build.
export const dynamic = 'force-dynamic';

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');
const MODE_LABELS: Record<string, string> = { smart_face: 'Auto-track', auto_center: 'Centre', manual: 'Manual' };

function Stat({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="fc-card p-5">
      <p className="fc-meta">{label}</p>
      <p className="fc-display mt-1 text-3xl font-extrabold text-white">{value}</p>
      {note && <p className="fc-meta mt-1">{note}</p>}
    </div>
  );
}

/**
 * Private launch metrics. Anyone who is not in ADMIN_EMAILS gets a 404, so
 * the page does not reveal that it exists.
 */
export default async function AdminPage() {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (!isAdmin(session?.user?.email)) notFound();

  const m = await getMetrics();
  const t = m.totals;
  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-6xl px-1 py-2 sm:px-2">
        <SiteHeader />
        <h1 className="fc-heading mt-10 text-2xl">Launch metrics</h1>
        <p className="fc-body mt-1">Live from the database. Times are UTC.</p>

        <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Users" value={t.users} note={`${t.signups7} in the last 7 days`} />
          <Stat label="Rendered at least once" value={pct(t.activated, t.users)} note={`${t.activated} of ${t.users} users`} />
          <Stat
            label="Came back in week 1"
            value={pct(m.retention.returned, m.retention.cohort)}
            note={m.retention.cohort ? `${m.retention.returned} of ${m.retention.cohort} users over 7 days old` : 'No one has been here 7 days yet'}
          />
          <Stat label="Active in the last 7 days" value={t.active7} note="users who started a render" />
          <Stat label="Renders completed" value={t.renders} note={`${t.minutes} minutes of video`} />
          <Stat label="Renders failed" value={t.failed} note={`${pct(t.failed, t.renders + t.failed)} of finished renders`} />
          <Stat
            label="Paying users"
            value={m.tiers.filter((x) => x.tier !== 'free').reduce((sum, x) => sum + x.users, 0)}
            note={m.tiers.map((x) => `${x.users} ${x.tier}`).join(' · ') || 'no users yet'}
          />
          <Stat
            label="Renders using Auto-track"
            value={pct(m.tracking.find((x) => x.mode === 'smart_face')?.renders ?? 0, t.renders)}
            note={m.tracking.map((x) => `${MODE_LABELS[x.mode] ?? x.mode} ${x.renders}`).join(' · ') || 'no renders yet'}
          />
        </section>

        <section className="fc-card mt-6 overflow-x-auto p-5">
          <h2 className="fc-heading">Last 14 days</h2>
          <table className="mt-3 w-full min-w-[480px] text-left text-sm">
            <thead className="fc-meta">
              <tr>
                <th className="py-1.5 font-medium">Day</th>
                <th className="py-1.5 text-right font-medium">Sign-ups</th>
                <th className="py-1.5 text-right font-medium">Active users</th>
                <th className="py-1.5 text-right font-medium">Renders</th>
                <th className="py-1.5 text-right font-medium">Failed</th>
              </tr>
            </thead>
            <tbody className="text-zinc-200">
              {m.daily.map((d) => (
                <tr key={d.day} className="border-t border-white/[0.06]">
                  <td className="py-1.5 font-mono text-xs">{d.day}</td>
                  <td className="py-1.5 text-right">{d.signups}</td>
                  <td className="py-1.5 text-right">{d.active}</td>
                  <td className="py-1.5 text-right">{d.renders}</td>
                  <td className={`py-1.5 text-right ${d.failed ? 'text-red-300' : ''}`}>{d.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="fc-card mt-6 p-5">
          <h2 className="fc-heading">Recent render failures</h2>
          {m.failures.length === 0 ? (
            <p className="fc-body mt-2">None recorded.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {m.failures.map((f, i) => (
                <li key={i} className="rounded-2xl border border-white/[0.06] p-3 text-sm">
                  <p className="fc-meta font-mono">
                    {f.at.toISOString().replace('T', ' ').slice(0, 16)} · {MODE_LABELS[f.mode] ?? f.mode}
                    {f.size ? ` · ${f.size}` : ''}
                    {f.seconds !== null ? ` · ${Math.round(f.seconds)} s` : ''}
                  </p>
                  <p className="mt-1 break-words text-zinc-200">{f.error || 'No message recorded'}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
        <SiteFooter />
      </div>
    </main>
  );
}
