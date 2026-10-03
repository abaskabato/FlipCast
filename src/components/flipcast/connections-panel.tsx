'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, ExternalLink, Loader2, Unplug } from 'lucide-react';

import {
  cancelPost,
  disconnectAccount,
  getSocialConfig,
  listAccounts,
  listPosts,
  TIKTOK_PRIVACY_LABELS,
  type Account,
  type Platform,
  type Post,
  type SocialConfig,
} from '@/lib/social/client';

const NAMES: Record<Platform, string> = { youtube: 'YouTube', tiktok: 'TikTok' };

const STATUS: Record<string, { label: string; tone: string }> = {
  uploading: { label: 'Uploading', tone: 'text-zinc-300' },
  scheduled: { label: 'Scheduled', tone: 'text-sky-300' },
  posting: { label: 'Sending', tone: 'text-sky-300' },
  processing: { label: 'Processing', tone: 'text-sky-300' },
  posted: { label: 'Posted', tone: 'text-emerald-300' },
  failed: { label: 'Failed', tone: 'text-red-300' },
  canceled: { label: 'Canceled', tone: 'text-zinc-500' },
};

/** Connected YouTube/TikTok accounts, and posts made or scheduled through them. */
export default function ConnectionsPanel() {
  const [config, setConfig] = useState<SocialConfig | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setAccounts(await listAccounts().catch(() => []));
    setPosts(await listPosts().catch(() => []));
  }, []);

  useEffect(() => {
    void getSocialConfig().then(setConfig).catch(() => setConfig({ youtube: false, tiktok: false, tiktokScheduling: false }));
    void refresh();
    // Report the outcome of a connect redirect, then tidy the URL.
    const q = new URLSearchParams(window.location.search);
    const connected = q.get('connected');
    const err = q.get('social_error');
    if (connected === 'youtube' || connected === 'tiktok') setMessage({ ok: true, text: `${NAMES[connected]} connected.` });
    if (err) setMessage({ ok: false, text: err });
    if (connected || err) window.history.replaceState({}, '', `${window.location.pathname}#connections`);
  }, [refresh]);

  const disconnect = async (a: Account) => {
    if (!window.confirm(`Disconnect ${a.displayName}? Scheduled posts to it will be canceled.`)) return;
    setBusy(a.id);
    try {
      await disconnectAccount(a.id);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (p: Post) => {
    setBusy(p.id);
    try {
      await cancelPost(p.id);
      await refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'Could not cancel.' });
    } finally {
      setBusy(null);
    }
  };

  if (!config) return <div className="fc-card p-6"><Loader2 className="h-5 w-5 animate-spin text-zinc-500" /></div>;
  const platforms = (['youtube', 'tiktok'] as Platform[]).filter((p) => config[p]);

  return (
    <div className="space-y-4">
      {message && (
        <div className={message.ok ? 'fc-notice-warn !border-emerald-500/25 !bg-emerald-500/10 !text-emerald-200' : 'fc-notice-error'} role="status">
          {message.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      <div className="fc-card divide-y divide-white/[0.06]">
        {platforms.length === 0 ? (
          <p className="fc-body p-6">Publishing to YouTube and TikTok is coming soon.</p>
        ) : (
          platforms.map((p) => {
            const mine = (accounts ?? []).filter((a) => a.platform === p);
            return (
              <div key={p} className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{NAMES[p]}</p>
                    <p className="fc-meta">
                      {p === 'youtube' ? 'Upload and schedule videos and Shorts.' : config.tiktokScheduling ? 'Post now or schedule.' : 'Post straight to your account.'}
                    </p>
                  </div>
                  <a href={`/api/social/${p}/connect`} className="fc-btn-secondary !min-h-[40px]">
                    {mine.length ? 'Connect another' : `Connect ${NAMES[p]}`}
                  </a>
                </div>
                {accounts === null ? (
                  <Loader2 className="mt-3 h-4 w-4 animate-spin text-zinc-500" />
                ) : (
                  mine.map((a) => (
                    <div key={a.id} className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="fc-gradient flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">
                          {a.displayName.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="truncate text-sm text-zinc-200">{a.displayName}</span>
                      </span>
                      <button onClick={() => void disconnect(a)} disabled={busy === a.id} className="fc-btn-ghost hover:!text-red-300">
                        {busy === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5" />}
                        Disconnect
                      </button>
                    </div>
                  ))
                )}
              </div>
            );
          })
        )}
      </div>

      {posts && posts.length > 0 && (
        <div className="fc-card p-2">
          <p className="px-3 pb-1 pt-2 text-sm font-semibold text-white">Posts</p>
          <ul className="divide-y divide-white/[0.05]">
            {posts.map((p) => {
              const s = STATUS[p.status] ?? { label: p.status, tone: 'text-zinc-300' };
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-zinc-100">{p.title || '(no caption)'}</p>
                    <p className="fc-meta">
                      {NAMES[p.platform]} · {p.accountName} · {TIKTOK_PRIVACY_LABELS[p.privacy] ?? p.privacy}
                      {p.scheduledAt && ` · ${new Date(p.scheduledAt).toLocaleString()}`}
                    </p>
                    {p.error && <p className="fc-meta !text-red-300">{p.error}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold ${s.tone}`}>
                      {p.status === 'scheduled' && <CalendarClock className="mr-1 inline h-3.5 w-3.5" />}
                      {s.label}
                    </span>
                    {p.url && (
                      <a href={p.url} target="_blank" rel="noopener noreferrer" className="fc-btn-ghost" aria-label="Open post">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                    {p.platform === 'tiktok' && p.status === 'scheduled' && (
                      <button onClick={() => void cancel(p)} disabled={busy === p.id} className="fc-btn-ghost hover:!text-red-300">
                        Cancel
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
