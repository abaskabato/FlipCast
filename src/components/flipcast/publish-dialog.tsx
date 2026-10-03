'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, ExternalLink, Loader2, Send, X } from 'lucide-react';

import { useSession } from '@/lib/auth-client';
import {
  connectInPopup,
  getSocialConfig,
  listAccounts,
  publishToTikTokNow,
  publishToYouTube,
  PublishError,
  scheduleTikTok,
  tiktokCreator,
  TIKTOK_PRIVACY_LABELS,
  type Account,
  type CreatorInfo,
  type Platform,
  type SocialConfig,
} from '@/lib/social/client';
import type { RenderedOutput } from '@/lib/video/ffmpeg-client';

/**
 * Publish one rendered clip to a connected YouTube channel or TikTok account,
 * now or later. The TikTok form follows TikTok's content-sharing rules for
 * apps: it names the account being posted to, makes the creator choose who can
 * view the post (no default), offers the interaction settings the account
 * allows, asks for commercial-content disclosure, and shows the consent line.
 */

const PLATFORM_NAMES: Record<Platform, string> = { youtube: 'YouTube', tiktok: 'TikTok' };

/** "2026-10-04T15:30" for a datetime-local input, in local time. */
function localInputValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Toggle({ label, checked, onChange, disabled, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <label className={`flex items-start justify-between gap-3 py-1.5 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <span>
        <span className="text-sm text-zinc-200">{label}</span>
        {hint && <span className="fc-meta block">{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-pink-500" />
    </label>
  );
}

export default function PublishDialog({
  output,
  durationSec,
  onClose,
}: {
  output: RenderedOutput;
  durationSec: number;
  onClose: () => void;
}) {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;

  const [config, setConfig] = useState<SocialConfig | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [platform, setPlatform] = useState<Platform>(output.ratio === '16:9' ? 'youtube' : 'tiktok');
  const [accountId, setAccountId] = useState('');
  const [connecting, setConnecting] = useState(false);

  const base = output.filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+\d+x\d+$/, '');
  const [title, setTitle] = useState(output.ratio === '9:16' ? `${base} #Shorts` : base);
  const [description, setDescription] = useState('');
  const [ytPrivacy, setYtPrivacy] = useState<'public' | 'unlisted' | 'private'>('public');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState(() => localInputValue(new Date(Date.now() + 60 * 60_000)));

  // TikTok
  const [creator, setCreator] = useState<CreatorInfo | null>(null);
  const [privacy, setPrivacy] = useState('');
  const [allowComment, setAllowComment] = useState(true);
  const [allowDuet, setAllowDuet] = useState(true);
  const [allowStitch, setAllowStitch] = useState(true);
  const [disclose, setDisclose] = useState(false);
  const [brandOrganic, setBrandOrganic] = useState(false);
  const [brandContent, setBrandContent] = useState(false);

  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<{ message: string; reconnect: boolean } | null>(null);
  const [done, setDone] = useState<{ message: string; url?: string } | null>(null);

  useEffect(() => {
    void getSocialConfig().then((c) => {
      setConfig(c);
      if (!c[platform]) setPlatform(c.youtube ? 'youtube' : 'tiktok');
    });
    void listAccounts().then(setAccounts).catch(() => setAccounts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mine = useMemo(() => accounts.filter((a) => a.platform === platform), [accounts, platform]);
  useEffect(() => {
    if (!mine.some((a) => a.id === accountId)) setAccountId(mine[0]?.id ?? '');
  }, [mine, accountId]);

  // TikTok asks apps to fetch the creator's settings before every post.
  useEffect(() => {
    setCreator(null);
    setPrivacy('');
    if (platform !== 'tiktok' || !accountId) return;
    tiktokCreator(accountId)
      .then((c) => {
        setCreator(c);
        if (c.commentDisabled) setAllowComment(false);
        if (c.duetDisabled) setAllowDuet(false);
        if (c.stitchDisabled) setAllowStitch(false);
      })
      .catch((e) => setError({ message: e.message, reconnect: e instanceof PublishError && e.reconnect }));
  }, [platform, accountId]);

  // TikTok: branded content cannot be private.
  useEffect(() => {
    if (brandContent && privacy === 'SELF_ONLY') setPrivacy('');
  }, [brandContent, privacy]);

  const connect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      const added = await connectInPopup(platform);
      setAccounts(await listAccounts());
      if (added) setAccountId(added.id);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : 'Could not connect.', reconnect: false });
    } finally {
      setConnecting(false);
    }
  }, [platform]);

  const scheduledIso = when === 'later' ? new Date(at).toISOString() : null;
  const tooLong = platform === 'tiktok' && creator ? durationSec > creator.maxDurationSec : false;
  const discloseIncomplete = disclose && !brandOrganic && !brandContent;
  const canSubmit =
    !busy &&
    !!accountId &&
    (platform === 'youtube' ? title.trim().length > 0 : !!creator && !!privacy && !tooLong && !discloseIncomplete) &&
    (when === 'now' || new Date(at).getTime() > Date.now() + 5 * 60_000);

  const submit = async () => {
    setError(null);
    setProgress(0);
    try {
      if (platform === 'youtube') {
        setBusy('Uploading to YouTube…');
        const url = await publishToYouTube(output.blob, { accountId, title: title.trim(), description, privacy: ytPrivacy, publishAt: scheduledIso }, setProgress);
        setDone({
          message: scheduledIso ? `Scheduled. YouTube will publish it on ${new Date(scheduledIso).toLocaleString()}.` : 'Uploaded to YouTube.',
          url,
        });
        return;
      }
      const form = {
        accountId,
        title,
        privacy,
        disableComment: !allowComment,
        disableDuet: !allowDuet,
        disableStitch: !allowStitch,
        brandContent: disclose && brandContent,
        brandOrganic: disclose && brandOrganic,
        durationSec,
      };
      if (scheduledIso) {
        if (!userId) throw new PublishError('Sign in again to schedule.');
        setBusy('Saving the clip for later…');
        await scheduleTikTok(output.blob, output.filename, userId, { ...form, scheduledAt: scheduledIso }, setProgress);
        setDone({ message: `Scheduled for ${new Date(scheduledIso).toLocaleString()}. You can cancel it from your Account page.` });
      } else {
        setBusy('Uploading to TikTok…');
        const status = await publishToTikTokNow(output.blob, form, (f) => {
          setProgress(f);
          if (f >= 1) setBusy('TikTok is processing the video…');
        });
        setDone({
          message:
            status === 'posted'
              ? 'Posted to TikTok. It may take a few minutes to appear on your profile.'
              : 'Uploaded. TikTok is still processing it; check your Account page for the result.',
        });
      }
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : 'Publishing failed.', reconnect: e instanceof PublishError && e.reconnect });
    } finally {
      setBusy(null);
    }
  };

  const available = config ? (['youtube', 'tiktok'] as Platform[]).filter((p) => config[p]) : [];
  const canSchedule = platform === 'youtube' || !!config?.tiktokScheduling;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="publish-title" className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-white/10 bg-[rgb(var(--fc-surface))] p-5 shadow-2xl sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="publish-title" className="fc-heading">Publish {output.ratio} clip</h2>
            <p className="fc-meta mt-0.5">Uploads straight from this browser to the platform.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="fc-btn-ghost !min-h-[40px] !px-2">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!config ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-pink-400" /></div>
        ) : done ? (
          <div className="mt-6 space-y-4 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
            <p className="text-sm text-zinc-200">{done.message}</p>
            {done.url && (
              <a href={done.url} target="_blank" rel="noopener noreferrer" className="fc-link justify-center">
                Open on {PLATFORM_NAMES[platform]} <ExternalLink className="ml-1 h-3.5 w-3.5" />
              </a>
            )}
            <button onClick={onClose} className="fc-btn-primary w-full">Done</button>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {available.length > 1 && (
              <div role="radiogroup" aria-label="Platform" className="grid grid-cols-2 gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1">
                {available.map((p) => (
                  <button key={p} role="radio" aria-checked={platform === p} onClick={() => setPlatform(p)} disabled={!!busy}
                    className={`min-h-[40px] rounded-full text-sm font-semibold transition-colors ${platform === p ? 'fc-gradient text-white' : 'text-zinc-400 hover:text-zinc-100'}`}>
                    {PLATFORM_NAMES[p]}
                  </button>
                ))}
              </div>
            )}

            {mine.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 text-center">
                <p className="text-sm text-zinc-200">Connect your {PLATFORM_NAMES[platform]} account to publish.</p>
                <p className="fc-meta mt-1">A sign-in window opens; your rendered clips stay here.</p>
                <button onClick={() => void connect()} disabled={connecting} className="fc-btn-primary mt-3">
                  {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {connecting ? 'Waiting for sign-in…' : `Connect ${PLATFORM_NAMES[platform]}`}
                </button>
              </div>
            ) : (
              <>
                <label className="block">
                  <span className="fc-meta">{platform === 'tiktok' ? 'Posting to' : 'Channel'}</span>
                  <select value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={!!busy}
                    className="mt-1 min-h-[44px] w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white">
                    {mine.map((a) => (<option key={a.id} value={a.id}>{a.displayName}</option>))}
                  </select>
                  {platform === 'tiktok' && creator && (
                    <span className="fc-meta mt-1 block">TikTok account: <strong className="text-zinc-200">{creator.nickname}</strong> (@{creator.username})</span>
                  )}
                </label>

                <label className="block">
                  <span className="fc-meta">{platform === 'tiktok' ? 'Caption' : 'Title'}</span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={platform === 'tiktok' ? 2200 : 100} disabled={!!busy}
                    className="mt-1 min-h-[44px] w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white" />
                </label>

                {platform === 'youtube' ? (
                  <>
                    <label className="block">
                      <span className="fc-meta">Description</span>
                      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={5000} disabled={!!busy}
                        className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white" />
                    </label>
                    {when === 'now' && (
                      <label className="block">
                        <span className="fc-meta">Visibility</span>
                        <select value={ytPrivacy} onChange={(e) => setYtPrivacy(e.target.value as typeof ytPrivacy)} disabled={!!busy}
                          className="mt-1 min-h-[44px] w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white">
                          <option value="public">Public</option>
                          <option value="unlisted">Unlisted</option>
                          <option value="private">Private</option>
                        </select>
                      </label>
                    )}
                  </>
                ) : !creator ? (
                  <div className="flex items-center gap-2 text-sm text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Checking your TikTok settings…</div>
                ) : (
                  <>
                    <label className="block">
                      <span className="fc-meta">Who can view this video</span>
                      <select value={privacy} onChange={(e) => setPrivacy(e.target.value)} disabled={!!busy} required
                        className="mt-1 min-h-[44px] w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white">
                        <option value="" disabled>Choose…</option>
                        {creator.privacyOptions.map((p) => (
                          <option key={p} value={p} disabled={brandContent && p === 'SELF_ONLY'}>
                            {TIKTOK_PRIVACY_LABELS[p] ?? p}{brandContent && p === 'SELF_ONLY' ? ' (not for branded content)' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-2">
                      <Toggle label="Allow comments" checked={allowComment} onChange={setAllowComment} disabled={creator.commentDisabled || !!busy} hint={creator.commentDisabled ? 'Turned off in your TikTok settings' : undefined} />
                      <Toggle label="Allow Duet" checked={allowDuet} onChange={setAllowDuet} disabled={creator.duetDisabled || !!busy} hint={creator.duetDisabled ? 'Turned off in your TikTok settings' : undefined} />
                      <Toggle label="Allow Stitch" checked={allowStitch} onChange={setAllowStitch} disabled={creator.stitchDisabled || !!busy} hint={creator.stitchDisabled ? 'Turned off in your TikTok settings' : undefined} />
                    </div>
                    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-2">
                      <Toggle label="Disclose video content" hint="Turn on if this promotes yourself, a brand, product or service." checked={disclose} onChange={setDisclose} disabled={!!busy} />
                      {disclose && (
                        <div className="border-t border-white/[0.06] pt-1">
                          <Toggle label="Your brand" hint="You are promoting yourself or your own business. Labelled 'Promotional content'." checked={brandOrganic} onChange={setBrandOrganic} disabled={!!busy} />
                          <Toggle label="Branded content" hint="You are promoting another brand or a third party. Labelled 'Paid partnership'." checked={brandContent} onChange={setBrandContent} disabled={!!busy} />
                          {discloseIncomplete && <p className="fc-meta pb-1 !text-amber-300">Choose at least one, or turn disclosure off.</p>}
                        </div>
                      )}
                    </div>
                    {tooLong && (
                      <p className="fc-notice-warn">This account can post videos up to {Math.floor(creator.maxDurationSec)} seconds; this clip is {Math.round(durationSec)} seconds.</p>
                    )}
                  </>
                )}

                <div>
                  <span className="fc-meta">When</span>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    <button onClick={() => setWhen('now')} disabled={!!busy} aria-pressed={when === 'now'}
                      className={`min-h-[44px] rounded-xl border text-sm font-semibold ${when === 'now' ? 'border-pink-400/70 bg-pink-500/[0.08] text-white' : 'border-white/10 text-zinc-400'}`}>
                      Now
                    </button>
                    <button onClick={() => setWhen('later')} disabled={!!busy || !canSchedule} aria-pressed={when === 'later'}
                      title={canSchedule ? undefined : 'Scheduling TikTok posts is not available yet'}
                      className={`min-h-[44px] rounded-xl border text-sm font-semibold disabled:opacity-40 ${when === 'later' ? 'border-pink-400/70 bg-pink-500/[0.08] text-white' : 'border-white/10 text-zinc-400'}`}>
                      <CalendarClock className="mr-1.5 inline h-4 w-4" />Schedule
                    </button>
                  </div>
                  {when === 'later' && (
                    <input type="datetime-local" value={at} min={localInputValue(new Date(Date.now() + 10 * 60_000))} onChange={(e) => setAt(e.target.value)} disabled={!!busy}
                      className="mt-2 min-h-[44px] w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white [color-scheme:dark]" />
                  )}
                  {when === 'later' && platform === 'tiktok' && (
                    <p className="fc-meta mt-1">TikTok cannot schedule posts itself, so the clip is kept privately on our servers until then and deleted after posting.</p>
                  )}
                </div>

                {platform === 'tiktok' && creator && (
                  <p className="fc-meta">
                    By posting, you agree to TikTok&apos;s{' '}
                    {brandContent && (<><a className="underline" href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noopener noreferrer">Branded Content Policy</a> and{' '}</>)}
                    <a className="underline" href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noopener noreferrer">Music Usage Confirmation</a>.
                  </p>
                )}
              </>
            )}

            {error && (
              <div className="fc-notice-error" role="alert">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {error.message}{' '}
                  {error.reconnect && (<button onClick={() => void connect()} className="underline">Reconnect</button>)}
                </span>
              </div>
            )}

            {busy && (
              <div className="space-y-1.5">
                <p className="flex items-center gap-2 text-sm text-zinc-200"><Loader2 className="h-4 w-4 animate-spin text-pink-400" />{busy}</p>
                <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]"><div className="fc-gradient h-full transition-all" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
              </div>
            )}

            {mine.length > 0 && (
              <button onClick={() => void submit()} disabled={!canSubmit} className="fc-btn-primary w-full">
                {when === 'later' ? <CalendarClock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                {when === 'later' ? `Schedule on ${PLATFORM_NAMES[platform]}` : `Post to ${PLATFORM_NAMES[platform]}`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
