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
  Download,
  Loader2,
  X,
  ShieldCheck,
  HardDrive,
  Clock,
} from 'lucide-react';

import { authClient, useSession } from '@/lib/auth-client';
import { AuthPanel } from './auth-panel';
import FocusPicker from './focus-picker';
import { renderToRatios, RenderAbortedError, type RenderedOutput } from '@/lib/video/ffmpeg-client';
import {
  CENTER_FOCUS,
  OUTPUT_CANVAS,
  type Focus,
  type Ratio,
} from '@/lib/video/geometry';
import { probeVideo, formatBytes, type VideoMeta } from '@/lib/video/probe';
import { BROWSER_MAX_INPUT_BYTES, formatDuration, formatQuota } from '@/lib/quotas';

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
  const loadUsage = useCallback(async () => {
    if (!signedIn) {
      setUsage(null);
      return;
    }
    try {
      const res = await fetch('/api/me/usage');
      if (!res.ok) return;
      const data = await res.json();
      setUsage({
        tier: data.tier,
        usedSeconds: data.usedSeconds,
        limitSeconds: data.limitSeconds,
        remainingSeconds: data.remainingSeconds,
      });
    } catch {
      // usage is non-critical; rendering still works
    }
  }, [signedIn]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  // ---- billing ----------------------------------------------------------
  /**
   * Send the user to Stripe Checkout.
   *
   * `?plan=` lets the caller choose a tier; the default is Creator, which is the
   * plan most people upgrading from the free tier want.
   *
   * A 503 is the expected response while billing is unconfigured (no Stripe
   * keys), so surface the server's reason rather than a generic failure. The
   * free allowance keeps working either way.
   */
  const openUpgrade = useCallback(async () => {
    setCheckoutBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams(window.location.search);
      const tier = params.get('plan') === 'agency' ? 'agency' : 'creator';
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, period: 'monthly' }),
      });

      if (!res.ok) {
        let message = 'Could not start checkout. Please try again.';
        try {
          const data = await res.json();
          if (typeof data?.message === 'string') message = data.message;
        } catch {
          // keep the default message
        }
        setNotice(message);
        return;
      }

      const { url } = (await res.json()) as { url?: string };
      if (!url) {
        setNotice('Checkout did not return a link. Please try again.');
        return;
      }
      // Full navigation so the session cookie is sent to Stripe and back.
      window.location.href = url;
    } catch {
      setNotice('Could not reach the server to start checkout.');
    } finally {
      setCheckoutBusy(false);
    }
  }, []);

  // After returning from Stripe, re-read usage so the new tier and the reset
  // window appear immediately instead of after a manual refresh.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgraded') === '1') {
      setNotice('Payment received. Your plan updates as soon as Stripe confirms it.');
      void loadUsage();
      // Drop the query string so a refresh does not re-trigger this.
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('cancelled') === '1') {
      setNotice('Checkout cancelled — nothing was charged.');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [loadUsage]);

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
    if (!file || !meta || isRendering) return;
    if (!signedIn) {
      setError('Sign in to render. It is free and needs no card.');
      return;
    }
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
  }, [file, meta, isRendering, signedIn, targets, trackingMode, focus, usage, loadUsage]);

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
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      {/* Header */}
      <header className="fc-card p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-600 p-2.5 text-white shadow-lg shadow-indigo-600/20">
              <Layers className="h-6 w-6" />
            </div>
            <div>
              <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight text-white">
                Flipcast
                <span className="fc-chip-accent">local render</span>
              </h1>
              <p className="fc-meta mt-0.5">
                {sessionPending
                  ? 'Checking session…'
                  : signedIn
                    ? (session?.user?.email ?? '')
                    : 'One clip in, every platform out'}
              </p>
            </div>
          </div>

          {signedIn ? (
            <button
              onClick={() => authClient.signOut()}
              className="fc-btn-ghost self-start"
            >
              Sign out
            </button>
          ) : (
            <div className="fc-chip-accent self-start !border-emerald-500/25 !bg-emerald-500/10 !text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              Nothing leaves your device
            </div>
          )}
        </div>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Work column: the render pipeline, in order. */}
        <div className="order-2 space-y-6 lg:order-1">
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
          disabled={!file || !meta || targets.length === 0}
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
                <button
                  onClick={() => downloadOutput(o)}
                  className="fc-btn-primary mt-auto w-full"
                >
                  <Download className="h-4 w-4" />
                  Download
                </button>
              </div>
            ))}
          </div>

          {phase && <p className="fc-meta">{phase}</p>}
        </section>
      )}

      </div>

        {/* Sidebar: account and quota. Sticky so the meter stays visible while
            the user scrolls through format options. */}
        <aside className="order-1 space-y-4 lg:order-2 lg:sticky lg:top-6">
          {!sessionPending && !signedIn && (
            <AuthPanel onSignedIn={() => void loadUsage()} />
          )}

          {usage && (
            <div className="fc-card space-y-3 p-5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="fc-heading">This month</h2>
                <span className="fc-chip-accent capitalize">{usage.tier}</span>
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
                    className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                    style={{ width: `${usagePercent}%` }}
                  />
                </div>
                <p className="fc-meta mt-2">
                  {formatQuota(usage.remainingSeconds)} of render time left
                </p>
              </div>

              {usage.tier === 'free' && (
                <button
                  onClick={openUpgrade}
                  disabled={checkoutBusy}
                  className="fc-btn-primary w-full"
                >
                  {checkoutBusy ? 'Opening…' : 'Upgrade plan'}
                </button>
              )}
            </div>
          )}

          <div className="fc-card space-y-3 p-5">
            <h2 className="fc-heading">How it works</h2>
            <ol className="space-y-3">
              {[
                'Drop in one horizontal master.',
                'Choose your formats and what stays in shot.',
                'We encode in this tab — nothing is uploaded.',
              ].map((step, i) => (
                <li key={step} className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-slate-300">
                    {i + 1}
                  </span>
                  <span className="fc-body">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>

      <footer className="mt-8 flex flex-wrap items-center justify-center gap-x-1 gap-y-1 pb-6 text-center text-xs text-slate-600">
        <span>Flipcast · renders run in your browser · MIT licensed</span>
        <span aria-hidden="true">·</span>
        <a href="/pricing" className="fc-link !text-slate-500 hover:!text-slate-300">
          Pricing
        </a>
      </footer>
    </div>
  );
}