'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload,
  Video,
  Layers,
  Sparkles,
  Check,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Loader2,
  X,
  ShieldCheck,
  HardDrive,
  Clock,
  CreditCard,
} from 'lucide-react';
import Link from 'next/link';

import { authClient, useSession } from '@/lib/auth-client';
import { AuthPanel } from './auth-panel';
import FocusPicker from './focus-picker';
import ShareActions from './share-actions';
import { renderToRatios, RenderAbortedError, type RenderedOutput } from '@/lib/video/ffmpeg-client';
import {
  CENTER_FOCUS,
  OUTPUT_CANVAS,
  type Focus,
  type Ratio,
} from '@/lib/video/geometry';
import { probeVideo, formatBytes, type VideoMeta } from '@/lib/video/probe';
import { BROWSER_MAX_INPUT_BYTES, formatDuration, formatQuota } from '@/lib/quotas';
import { openBillingPortal, startCheckout } from '@/lib/billing/client';
import { isBillingPeriod, isPaidTier } from '@/lib/billing/plans';
import { SiteFooter } from './site-chrome';

type TargetRatio = Ratio;
type TrackingMode = 'auto_center' | 'smart_face' | 'manual_crop';

type Usage = {
  tier: string;
  usedSeconds: number;
  limitSeconds: number;
  remainingSeconds: number;
};

const RATIO_OPTIONS: { id: TargetRatio; title: string; desc: string; platforms: string }[] = [
  { id: '9:16', title: '9:16 Vertical', desc: 'Full-bleed vertical', platforms: 'TikTok · Reels · Shorts' },
  { id: '1:1', title: '1:1 Square', desc: 'Feed post crop', platforms: 'Instagram · LinkedIn' },
  { id: '16:9', title: '16:9 Landscape', desc: 'Widescreen master', platforms: 'YouTube · X' },
];

const MODE_OPTIONS: { id: TrackingMode; title: string; desc: string }[] = [
  { id: 'auto_center', title: 'Auto Centre', desc: 'Centred crop, no distortion' },
  { id: 'smart_face', title: 'Smart Face Track', desc: 'Subject-aware reframing' },
  { id: 'manual_crop', title: 'Manual Crop', desc: 'Choose your own framing' },
];

const MAX_FILE_BYTES = BROWSER_MAX_INPUT_BYTES;

/** sessionStorage key carrying a plan picked on /pricing across sign-in. */
const CHECKOUT_INTENT_KEY = 'flipcast:checkout-intent';

export default function FlipcastDashboard() {
  const { data: session, isPending: sessionPending } = useSession();

  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [targets, setTargets] = useState<TargetRatio[]>(['9:16']);
  const [trackingMode, setTrackingMode] = useState<TrackingMode>('auto_center');
  // Manual crop focal point, as fractions of the frame. Applies to every output.
  const [focus, setFocus] = useState<Focus>(CENTER_FOCUS);

  const [usage, setUsage] = useState<Usage | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('');
  const [outputs, setOutputs] = useState<RenderedOutput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const signedIn = Boolean(session?.user);

  // ---- usage ------------------------------------------------------------
  const loadUsage = useCallback(async (): Promise<Usage | null> => {
    if (!signedIn) {
      setUsage(null);
      return null;
    }
    try {
      const res = await fetch('/api/me/usage');
      if (!res.ok) return null;
      const data = await res.json();
      const next: Usage = {
        tier: data.tier,
        usedSeconds: data.usedSeconds,
        limitSeconds: data.limitSeconds,
        remainingSeconds: data.remainingSeconds,
      };
      setUsage(next);
      return next;
    } catch {
      // usage is non-critical; rendering still works
      return null;
    }
  }, [signedIn]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  // ---- billing ----
  const openPortal = useCallback(async () => {
    setCheckoutBusy(true);
    const outcome = await openBillingPortal();
    if (outcome.kind === 'message') setNotice(outcome.message);
    setCheckoutBusy(false);
  }, []);

  // Resume a checkout chosen on /pricing before the user had signed in.
  //
  // The plan arrives as `?plan=&period=`, but the auth forms navigate to "/"
  // after signing in, which drops the query string. So the intent is moved
  // into sessionStorage as soon as the page loads, and read back from there.
  const checkoutResumed = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tier = params.get('plan');
    if (!isPaidTier(tier)) return;
    const period = params.get('period');
    try {
      sessionStorage.setItem(
        CHECKOUT_INTENT_KEY,
        JSON.stringify({ tier, period: isBillingPeriod(period) ? period : 'monthly' }),
      );
    } catch {
      // Storage blocked: the URL still works if the user is already signed in.
    }
    window.history.replaceState({}, '', window.location.pathname + window.location.hash);
    if (!signedIn) setNotice('Sign in or create an account to continue to checkout.');
    // Only on first load; the signed-in branch below does the resuming.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!signedIn || checkoutResumed.current) return;
    let intent: { tier?: unknown; period?: unknown } | null = null;
    try {
      intent = JSON.parse(sessionStorage.getItem(CHECKOUT_INTENT_KEY) ?? 'null');
      sessionStorage.removeItem(CHECKOUT_INTENT_KEY);
    } catch {
      intent = null;
    }
    if (!intent || !isPaidTier(intent.tier)) return;
    checkoutResumed.current = true;
    setCheckoutBusy(true);
    setNotice('Taking you to checkout…');
    void startCheckout(intent.tier, isBillingPeriod(intent.period) ? intent.period : 'monthly').then(
      (outcome) => {
        if (outcome.kind === 'message') setNotice(outcome.message);
        if (outcome.kind !== 'redirected') setCheckoutBusy(false);
      },
    );
  }, [signedIn]);

  // Back from Stripe. The tier is written by the webhook, which can land a few
  // seconds after the redirect, so poll briefly rather than show a stale plan.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('cancelled') === '1') {
      setNotice('Checkout cancelled — nothing was charged.');
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }
    if (params.get('upgraded') !== '1' || !signedIn) return;
    window.history.replaceState({}, '', window.location.pathname);
    setNotice('Payment received — activating your plan…');
    let cancelled = false;
    void (async () => {
      for (let i = 0; i < 15 && !cancelled; i++) {
        const u = await loadUsage();
        if (u && u.tier !== 'free') {
          setNotice(`You're on ${u.tier[0].toUpperCase()}${u.tier.slice(1)}. Thanks for subscribing!`);
          return;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!cancelled) {
        setNotice('Payment received. Your plan will appear shortly — refresh in a minute.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn, loadUsage]);

  /** Bring the account panel into view and put the cursor in it. */
  const focusAccount = useCallback(() => {
    const panel = document.getElementById('account');
    panel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => panel?.querySelector<HTMLInputElement>('input')?.focus(), 350);
  }, []);

  // ---- file selection ---------------------------------------------------
  const acceptFile = useCallback(
    async (next: File | null) => {
      setError(null);
      setNotice(null);
      setOutputs([]);
      if (!next) {
        setFile(null);
        setMeta(null);
        return;
      }
      if (next.size > MAX_FILE_BYTES) {
        setError(`That file is ${formatBytes(next.size)}. The limit is ${formatBytes(MAX_FILE_BYTES)}.`);
        setFile(null);
        setMeta(null);
        return;
      }
      setFile(next);
      try {
        const probed = await probeVideo(next);
        setMeta(probed);
        if (signedIn && usage && probed.durationSeconds > usage.remainingSeconds) {
          setNotice(
            `This clip is ${formatDuration(probed.durationSeconds)}, but you have ${formatQuota(usage.remainingSeconds)} left this month.`,
          );
        }
      } catch (e) {
        setFile(null);
        setMeta(null);
        setError(e instanceof Error ? e.message : 'Could not read that video.');
      }
    },
    [signedIn, usage],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      const dropped = e.dataTransfer.files?.[0];
      if (dropped) void acceptFile(dropped);
    },
    [acceptFile],
  );

  // ---- render -----------------------------------------------------------
  const startRender = useCallback(async () => {
    if (!signedIn) {
      focusAccount();
      return;
    }
    if (!file || !meta || isRendering) return;
    if (targets.length === 0) {
      setError('Pick at least one output format.');
      return;
    }
    if (usage && meta.durationSeconds > usage.remainingSeconds) {
      setError(
        `Not enough quota left. This clip needs ${formatDuration(meta.durationSeconds)}; you have ${formatQuota(usage.remainingSeconds)}.`,
      );
      return;
    }

    setIsRendering(true);
    setProgress(0);
    setPhase('Preparing…');
    setError(null);
    setOutputs([]);
    const controller = new AbortController();
    abortRef.current = controller;

    // Authorise + reserve quota before spending a long render.
    let jobId: string | null = null;
    try {
      const startRes = await fetch('/api/transform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          targets,
          mode: trackingMode,
          sourceDurationSeconds: meta.durationSeconds,
          sourceWidth: meta.width,
          sourceHeight: meta.height,
          sourceSizeBytes: file.size,
        }),
      });
      const startBody = await startRes.json().catch(() => ({}));
      if (!startRes.ok) {
        setError(startBody.error ?? 'Could not start the render.');
        setIsRendering(false);
        abortRef.current = null;
        return;
      }
      jobId = startBody.jobId;
      setUsage(startBody.usage ?? null);
    } catch {
      setError('Could not reach the server to reserve your quota.');
      setIsRendering(false);
      abortRef.current = null;
      return;
    }

    try {
      const result = await renderToRatios(file, targets, {
        signal: controller.signal,
        // Manual crop is the only mode that moves the window; the others keep
        // centred framing so this stays undefined for them.
        focus: trackingMode === 'manual_crop' ? focus : null,
        onProgress: ({ progress: p, label }) => {
          setProgress(p);
          setPhase(label);
        },
      });

      setOutputs(result.outputs);
      setProgress(1);
      setPhase(
        `Done in ${formatDuration(result.elapsedSeconds)} · rendered locally, nothing uploaded`,
      );

      await fetch('/api/transform', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          status: 'completed',
          outputs: result.outputs.map((o) => ({
            ratio: o.ratio,
            sizeBytes: o.sizeBytes,
            width: o.width,
            height: o.height,
          })),
        }),
      }).catch(() => undefined);
      void loadUsage();
    } catch (e) {
      const aborted = e instanceof RenderAbortedError;
      setError(aborted ? 'Render cancelled.' : e instanceof Error ? e.message : 'Render failed.');
      // Report cancellations too: either terminal state refunds the reservation,
      // and an unreported job would otherwise sit in "rendering" forever.
      await fetch('/api/transform', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          aborted
            ? { jobId, status: 'canceled' }
            : { jobId, status: 'failed', error: String(e).slice(0, 400) },
        ),
      }).catch(() => undefined);
      void loadUsage();
    } finally {
      setIsRendering(false);
      abortRef.current = null;
    }
  }, [file, meta, isRendering, signedIn, targets, trackingMode, focus, usage, loadUsage, focusAccount]);

  const cancelRender = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const toggleTarget = (ratio: TargetRatio) => {
    setTargets((prev) =>
      prev.includes(ratio) ? prev.filter((r) => r !== ratio) : [...prev, ratio],
    );
  };

  const downloadOutput = (output: RenderedOutput) => {
    const url = URL.createObjectURL(output.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = output.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Give the browser a moment to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  const downloadAll = () => {
    outputs.forEach((o, i) => setTimeout(() => downloadOutput(o), i * 400));
  };

  // One stable object URL per output.
  //
  // Creating these inline in JSX would mint a fresh URL on every re-render
  // (progress ticks, quota refreshes), which leaks the old ones and makes the
  // <video> previews restart from frame 0. Revoke them when the outputs change.
  const previewUrls = useMemo(() => {
    const urls = new Map<string, string>();
    for (const o of outputs) urls.set(o.ratio, URL.createObjectURL(o.blob));
    return urls;
  }, [outputs]);

  useEffect(() => {
    const urls = previewUrls;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
    };
  }, [previewUrls]);

  const reset = () => {
    setFile(null);
    setMeta(null);
    setOutputs([]);
    setProgress(0);
    setPhase('');
    setError(null);
    setNotice(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const usagePercent = usage
    ? Math.min(100, (usage.usedSeconds / Math.max(1, usage.limitSeconds)) * 100)
    : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-1 py-2 sm:px-2">
      {/* Header */}
      <header className="flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Flipcast home">
          <span className="rounded-xl bg-indigo-600 p-2 text-white shadow-lg shadow-indigo-600/25">
            <Layers className="h-5 w-5" />
          </span>
          <span className="text-lg font-bold tracking-tight text-white">Flipcast</span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          <Link href="/pricing" className="fc-btn-ghost !text-sm">
            Pricing
          </Link>
          {signedIn ? (
            <>
              <span
                className="hidden max-w-[14rem] truncate px-2 text-sm text-slate-400 md:inline"
                title={session?.user?.email ?? ''}
              >
                {session?.user?.email}
              </span>
              <button onClick={() => authClient.signOut()} className="fc-btn-ghost !text-sm">
                Sign out
              </button>
            </>
          ) : (
            !sessionPending && (
              <button onClick={focusAccount} className="fc-btn-secondary !min-h-[36px] !px-3">
                Sign in
              </button>
            )
          )}
        </nav>
      </header>

      {/* Pitch for first-time visitors. Signed-in users go straight to work. */}
      {!sessionPending && !signedIn && (
        <section className="grid items-center gap-8 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:py-8">
          <div>
            <p className="fc-chip-accent !border-emerald-500/25 !bg-emerald-500/10 !text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              Your footage never leaves your device
            </p>
            <h1 className="mt-4 max-w-xl text-4xl font-bold leading-[1.1] tracking-tight text-white sm:text-5xl">
              One clip in. Every platform out.
            </h1>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-slate-400">
              Turn a horizontal video into vertical, square and widescreen cuts for TikTok,
              Reels, Shorts and YouTube — rendered right here in your browser. No uploads, no
              queue.
            </p>
            <ol className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-300">
              {['Drop a video', 'Pick formats & framing', 'Download'].map((step, i) => (
                <li key={step} className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-indigo-300">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>

          {/* The three output shapes, to scale, so the product reads at a glance. */}
          <div aria-hidden="true" className="hidden items-end gap-3 md:flex">
            {[
              { label: '9:16', w: 72, h: 128 },
              { label: '1:1', w: 104, h: 104 },
              { label: '16:9', w: 168, h: 94.5 },
            ].map((f) => (
              <div key={f.label} className="flex flex-col items-center gap-2">
                <div
                  className="rounded-lg border border-indigo-400/40 bg-gradient-to-br from-indigo-500/25 via-slate-900 to-slate-900 shadow-lg shadow-indigo-500/10"
                  style={{ width: f.w, height: f.h }}
                />
                <span className="font-mono text-xs text-slate-500">{f.label}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Work column: the render pipeline, in order. */}
        <div className="space-y-6">
      {/* Upload */}
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(e) => {
          // preventDefault lives on DragEvent; stopPropagation does not.
          e.preventDefault();
          setDragActive(false);
        }}
        onDrop={onDrop}
        onClick={() => !isRendering && inputRef.current?.click()}
        className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-all duration-200 ${
          dragActive
            ? 'border-indigo-500 bg-indigo-500/5'
            : 'border-slate-700 bg-slate-900/50 hover:border-slate-600 hover:bg-slate-900'
        } ${isRendering ? 'pointer-events-none opacity-60' : ''}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,video/x-matroska,video/*"
          className="hidden"
          onChange={(e) => void acceptFile(e.target.files?.[0] ?? null)}
        />
        {file && meta ? (
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-full border border-emerald-500/20 bg-emerald-500/10 p-3">
              <Video className="h-6 w-6 text-emerald-400" />
            </div>
            <p className="max-w-full truncate text-sm font-semibold text-white">{file.name}</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="fc-chip font-mono !text-emerald-300">
                {meta.width}×{meta.height}
              </span>
              <span className="fc-chip">
                <Clock className="h-3.5 w-3.5" />
                {formatDuration(meta.durationSeconds)}
              </span>
              <span className="fc-chip">
                <HardDrive className="h-3.5 w-3.5" />
                {formatBytes(file.size)}
              </span>
            </div>
            {!isRendering && outputs.length === 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  reset();
                }}
                className="fc-btn-ghost"
              >
                <X className="h-3.5 w-3.5" />
                Choose a different file
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-full bg-slate-800 p-3.5">
              <Upload className="h-6 w-6 text-slate-400" />
            </div>
            <p className="text-base font-medium text-slate-200">
              Drop a horizontal master, or click to browse
            </p>
            <p className="fc-meta">
              MP4, MOV, WebM or MKV up to {formatBytes(MAX_FILE_BYTES)}
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="fc-notice-error" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!error && notice && (
        <div className="fc-notice-warn" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Engine params */}
      <section className="grid gap-6 xl:grid-cols-2">
        <div className="fc-card space-y-3 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="fc-heading">Output formats</h2>
            <span className="fc-chip-accent shrink-0">
              {targets.length} selected
            </span>
          </div>
          <p className="fc-body">
            Pick any combination. Each format is rendered from the same source.
          </p>
          <div className="grid gap-2">
            {RATIO_OPTIONS.map((ratio) => {
              const active = targets.includes(ratio.id);
              const canvas = OUTPUT_CANVAS[ratio.id];
              return (
                <button
                  key={ratio.id}
                  onClick={() => toggleTarget(ratio.id)}
                  disabled={isRendering}
                  aria-pressed={active}
                  className={`flex min-h-[56px] items-center justify-between gap-3 rounded-xl border p-3 text-left transition-all disabled:opacity-50 ${
                    active
                      ? 'border-indigo-500 bg-indigo-500/5 ring-1 ring-indigo-500'
                      : 'border-slate-800 bg-slate-950 hover:border-slate-700 hover:bg-slate-900'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                        active ? 'border-indigo-400 bg-indigo-500' : 'border-slate-600'
                      }`}
                    >
                      {active && <Check className="h-3 w-3 text-white" />}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-white">{ratio.title}</p>
                      <p className="fc-meta">{ratio.platforms}</p>
                    </div>
                  </div>
                  <span className="fc-chip shrink-0 font-mono">
                    {canvas.w}×{canvas.h}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="fc-card space-y-3 p-5">
          <h2 className="fc-heading">Reframing mode</h2>
          <div className="grid gap-2">
            {MODE_OPTIONS.map((mode) => (
              <button
                key={mode.id}
                onClick={() => setTrackingMode(mode.id)}
                disabled={isRendering}
                aria-pressed={trackingMode === mode.id}
                className={`min-h-[56px] rounded-xl border p-3 text-left transition-all disabled:opacity-50 ${
                  trackingMode === mode.id
                    ? 'border-indigo-500 bg-indigo-500/5 ring-1 ring-indigo-500'
                    : 'border-slate-800 bg-slate-950 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                <p className="flex items-center gap-2 text-sm font-semibold text-white">
                  {mode.id === 'smart_face' && <Sparkles className="h-3.5 w-3.5 text-indigo-400" />}
                  {mode.title}
                </p>
                <p className="fc-body mt-0.5">{mode.desc}</p>
                {mode.id === 'smart_face' && (
                  <p className="fc-meta mt-1.5 text-amber-300/90">
                    Subject tracking is in preview — currently renders centred.
                  </p>
                )}
                {mode.id === 'manual_crop' && (
                  <p className="fc-meta mt-1.5 text-emerald-300/90">
                    Click or drag the frame below to choose what stays in shot.
                  </p>
                )}
              </button>
            ))}
          </div>

          {trackingMode === 'manual_crop' && file && (
            <FocusPicker
              focus={focus}
              onChange={setFocus}
              disabled={isRendering}
              sourceWidth={meta?.width ?? null}
              sourceHeight={meta?.height ?? null}
              ratios={targets}
            />
          )}
        </div>
      </section>

      {/* Action */}
      {isRendering ? (
        <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-medium text-slate-200">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
              {phase || 'Rendering…'}
            </span>
            <button
              onClick={cancelRender}
              className="fc-btn-ghost hover:!text-red-300"
            >
              Cancel
            </button>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-slate-800"
            role="progressbar"
            aria-valuenow={Math.round(progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Render progress"
          >
            <div
              className="h-full rounded-full bg-indigo-500 transition-all duration-200"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <p className="fc-meta">
            Rendering on this device. Local encoding is slower than a server but keeps your file
            private. Keep this tab open.
          </p>
        </div>
      ) : (
        <button
          onClick={startRender}
          disabled={signedIn && (!file || !meta || targets.length === 0)}
          className="group flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 transition-all hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:shadow-none"
        >
          {signedIn ? 'Render on this device' : 'Sign in to render'}
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </button>
      )}

      {/* Outputs */}
      {outputs.length > 0 && (
        <section className="fc-card space-y-4 !border-emerald-500/25 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-semibold text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              {outputs.length} {outputs.length === 1 ? 'format' : 'formats'} ready
            </h2>
            <div className="flex gap-2">
              <button onClick={downloadAll} className="fc-btn !bg-emerald-600 hover:!bg-emerald-500">
                Download all
              </button>
              <button onClick={reset} className="fc-btn-secondary">
                Start over
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {outputs.map((o) => (
              <div
                key={o.ratio}
                className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950 p-4"
              >
                <video
                  src={previewUrls.get(o.ratio)}
                  className="aspect-square w-full rounded-lg bg-black object-contain"
                  controls
                  playsInline
                />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-white">{o.ratio} · {o.width}×{o.height}</p>
                  <p className="fc-meta">{formatBytes(o.sizeBytes)}</p>
                </div>
                <ShareActions output={o} onDownload={downloadOutput} />
              </div>
            ))}
          </div>

          {phase && <p className="fc-meta">{phase}</p>}
        </section>
      )}

      </div>

        {/* Sidebar: account and plan. Below the work on mobile, so the first
            screen is the product rather than a form; sticky on desktop so the
            meter stays visible while scrolling through options. */}
        <aside id="account" className="scroll-mt-6 space-y-4 lg:sticky lg:top-6">
          {!sessionPending && !signedIn && (
            <AuthPanel onSignedIn={() => void loadUsage()} />
          )}

          {usage && (
            <div className="fc-card space-y-4 p-5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="fc-heading">This month</h2>
                <span className="fc-chip-accent capitalize">{usage.tier} plan</span>
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-white">
                    {formatQuota(usage.usedSeconds)}
                  </span>
                  <span className="fc-meta">of {formatQuota(usage.limitSeconds)}</span>
                </div>
                <div
                  className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800"
                  role="progressbar"
                  aria-valuenow={Math.round(usagePercent)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Monthly render time used"
                >
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      usagePercent >= 90 ? 'bg-amber-400' : 'bg-indigo-500'
                    }`}
                    style={{ width: `${usagePercent}%` }}
                  />
                </div>
                <p className="fc-meta mt-2">
                  {formatQuota(usage.remainingSeconds)} of render time left
                </p>
              </div>

              {usage.tier === 'free' ? (
                <div className="space-y-2 rounded-xl border border-indigo-500/25 bg-indigo-500/[0.06] p-4">
                  <p className="text-sm font-semibold text-white">Need more minutes?</p>
                  <p className="fc-body">
                    Creator gives you an hour a month and clips up to 15 minutes.
                  </p>
                  <Link href="/pricing" className="fc-btn-primary mt-1 w-full">
                    See plans
                  </Link>
                </div>
              ) : (
                <button
                  onClick={() => void openPortal()}
                  disabled={checkoutBusy}
                  className="fc-btn-secondary w-full"
                >
                  {checkoutBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CreditCard className="h-4 w-4" />
                  )}
                  Manage billing
                </button>
              )}
            </div>
          )}

          <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-slate-500">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400/80" />
            Videos are encoded in this tab. Only the file name, duration and format reach our
            server.
          </p>
        </aside>
      </div>

      <SiteFooter />
    </div>
  );
}