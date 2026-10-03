'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload,
  Video,
  Sparkles,
  Check,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  X,
  ShieldCheck,
  HardDrive,
  Clock,
  CreditCard,
  Crop,
  ScanFace,
  Focus as FocusIcon,
  ArrowRight,
  RefreshCw,
  Link2,
  Scissors,
  Wand2,
} from 'lucide-react';
import Link from 'next/link';

import { useSession } from '@/lib/auth-client';
import { AuthPanel } from './auth-panel';
import FocusPicker from './focus-picker';
import ShareActions from './share-actions';
import {
  renderToRatios,
  RenderAbortedError,
  transcribeSource,
  type RenderedOutput,
  type Trim,
} from '@/lib/video/ffmpeg-client';
import { detectSubject, TrackingUnavailableError } from '@/lib/video/subject-detect';
import { smoothPath, type SubjectPath } from '@/lib/video/tracking';
import { importFromLink } from '@/lib/import/client';
import { CLIP_LENGTHS, toLines, type ClipLength, type ClipSuggestion } from '@/lib/clips/lines';
import type { CaptionWord } from '@/lib/captions/captions';
import { isWholeClip, planSplitSegments, type SplitSegment } from '@/lib/video/layout';
import { CAPTION_STYLES, type CaptionStyleId } from '@/lib/captions/captions';
import { transcribe, type CaptionModel } from '@/lib/captions/transcribe';
import {
  CENTER_FOCUS,
  outputCanvas,
  type Focus,
  type Ratio,
} from '@/lib/video/geometry';
import { probeVideo, formatBytes, type VideoMeta } from '@/lib/video/probe';
import {
  BROWSER_MAX_INPUT_BYTES,
  MAX_SOURCE_SECONDS,
  TIER_LIMITS,
  formatDuration,
  formatQuota,
} from '@/lib/quotas';
import { openBillingPortal, startCheckout } from '@/lib/billing/client';
import { isBillingPeriod, isPaidTier } from '@/lib/billing/plans';
import { SiteFooter } from './site-chrome';
import LandingSections from './landing-sections';
import LiveDemo from './live-demo';
import RealDemo, { HeroShowcase } from './real-demo';
import { displayName, SiteHeader } from './site-header';

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

const PLATFORM_PILLS = [
  { name: 'TikTok', dot: 'bg-cyan-400' },
  { name: 'Reels', dot: 'bg-pink-500' },
  { name: 'Shorts', dot: 'bg-red-500' },
  { name: 'YouTube', dot: 'bg-red-500' },
  { name: 'LinkedIn', dot: 'bg-sky-500' },
  { name: 'X', dot: 'bg-zinc-200' },
];

/** A tiny preview of each caption style, drawn with CSS to match the ASS output. */
function CaptionSwatch({ style }: { style: CaptionStyleId }) {
  const base = 'font-display text-lg font-extrabold uppercase tracking-tight';
  const outline = { textShadow: '0 0 3px #000, 0 0 3px #000, 2px 2px 0 #000' };
  return (
    <span
      aria-hidden="true"
      className="flex h-12 w-full items-center justify-center rounded-xl bg-gradient-to-br from-zinc-700 to-zinc-900"
    >
      {style === 'clean' ? (
        <span className={`${base} rounded-md bg-black/50 px-2 text-white`}>Flip it</span>
      ) : style === 'single' ? (
        <span className={`${base} !text-2xl text-white`} style={outline}>
          Flip
        </span>
      ) : (
        <span className={base} style={outline}>
          <span className="text-white">Flip </span>
          <span className={style === 'pop' ? 'text-pink-500' : 'text-yellow-300'}>it</span>
          {/* Reveal: the next word is not on screen yet. */}
          <span className={style === 'reveal' ? 'text-white/15' : 'text-white'}> now</span>
        </span>
      )}
    </span>
  );
}

const MODE_OPTIONS: {
  id: TrackingMode;
  title: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}[] = [
  { id: 'smart_face', title: 'Auto-track', desc: 'Finds the speaker in every shot and follows them', icon: ScanFace, badge: 'Best' },
  { id: 'auto_center', title: 'Centre', desc: 'A steady centred crop, fastest to render', icon: FocusIcon },
  { id: 'manual_crop', title: 'Manual', desc: 'Drag the frame to choose what stays in shot', icon: Crop },
];

/** A numbered step heading, so the panels read as one flow from top to bottom. */
function StepHeading({ n, children, aside }: { n: number; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="fc-heading flex items-center gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-pink-400/40 bg-pink-500/10 text-xs font-bold text-pink-300">
          {n}
        </span>
        {children}
      </h2>
      {aside}
    </div>
  );
}

const MAX_FILE_BYTES = BROWSER_MAX_INPUT_BYTES;

/** The demo clip from the landing page (public/demo/CREDITS.txt). */
const SAMPLE_URL = '/demo/podcast-source.mp4';
const SAMPLE_NAME = 'sample-podcast.mp4';

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
  // Auto-track only: stack two people in the 9:16 cut when both are on camera.
  const [splitOn, setSplitOn] = useState(true);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyleId>('bold');
  const [captionModel, setCaptionModel] = useState<CaptionModel>('fast');

  // AI clip finding: the transcript is made on this device and kept per file,
  // so captions for a chosen clip reuse it instead of transcribing again.
  const [clipLength, setClipLength] = useState<ClipLength>('medium');
  const [clipWords, setClipWords] = useState<CaptionWord[] | null>(null);
  const [suggestions, setSuggestions] = useState<ClipSuggestion[] | null>(null);
  const [clipPhase, setClipPhase] = useState<{ label: string; progress: number } | null>(null);
  const [clipError, setClipError] = useState<string | null>(null);
  const [trim, setTrim] = useState<Trim | null>(null);
  const [srt, setSrt] = useState<string | null>(null);

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
      setClipWords(null);
      setSuggestions(null);
      setClipError(null);
      setTrim(null);
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
    // A chosen clip is what gets rendered, so it is what counts.
    const renderSeconds = trim ? trim.end - trim.start : meta.durationSeconds;
    if (usage && renderSeconds > usage.remainingSeconds) {
      setError(
        `Not enough quota left. This clip needs ${formatDuration(renderSeconds)}; you have ${formatQuota(usage.remainingSeconds)}.`,
      );
      return;
    }

    setIsRendering(true);
    setProgress(0);
    setPhase('Preparing…');
    setError(null);
    setOutputs([]);
    setSrt(null);
    setNotice(null);
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
          sourceDurationSeconds: trim ? trim.end - trim.start : meta.durationSeconds,
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
      const notes: string[] = [];

      // Auto-track: find the subject first, then render with a moving crop.
      // Takes the first 15% of the bar. Any failure falls back to centred.
      let track: SubjectPath | null = null;
      let split: SplitSegment[] = [];
      const trackShare = trackingMode === 'smart_face' ? 0.15 : 0;
      if (trackingMode === 'smart_face') {
        setPhase('Finding the speaker…');
        try {
          const samples = await detectSubject(file, meta.durationSeconds, {
            signal: controller.signal,
            range: trim,
            onProgress: (f) => {
              setProgress(f * trackShare);
              setPhase(`Finding the speaker · ${Math.round(f * 100)}%`);
            },
          });
          track = smoothPath(samples);
          if (!track) notes.push('No face was found, so the clip was framed from the centre.');
          if (splitOn && targets.includes('9:16')) {
            split = planSplitSegments(samples, meta.width, meta.height);
            if (isWholeClip(split)) {
              notes.push('Two people were on camera together, so the 9:16 cut uses split screen.');
            } else if (split.length) {
              notes.push(
                `The 9:16 cut switches to split screen ${split.length === 1 ? 'once' : `${split.length} times`}, while both people are on camera.`,
              );
            }
          }
        } catch (e) {
          if (controller.signal.aborted) throw new RenderAbortedError();
          notes.push(
            e instanceof TrackingUnavailableError
              ? `${e.message} It was framed from the centre instead.`
              : 'Auto-track could not run here, so the clip was framed from the centre.',
          );
        }
      }

      const result = await renderToRatios(file, targets, {
        signal: controller.signal,
        trim,
        // Clip finding already transcribed this file; captions reuse it.
        captionWords: clipWords,
        // Manual crop moves the window to a fixed point; auto-track moves it
        // over time; otherwise framing stays centred.
        focus: trackingMode === 'manual_crop' ? focus : null,
        track,
        split,
        // Lets the engine size outputs to the source and copy instead of
        // re-encoding where the output would be identical.
        source: meta,
        captions: captionsOn
          ? {
              style: captionStyle,
              transcribe: (pcm, report) =>
                transcribe(pcm, {
                  signal: controller.signal,
                  model: captionModel,
                  onProgress: (p) =>
                    p.stage === 'download'
                      ? report(
                          p.fraction * 0.4,
                          `Getting the caption model ready (one time) · ${formatBytes(p.loadedBytes)} of ${formatBytes(p.totalBytes)}`,
                        )
                      : report(0.4 + p.fraction * 0.6, `Writing captions · ${Math.round(p.fraction * 100)}%`),
                }),
            }
          : null,
        onProgress: ({ progress: p, label }) => {
          setProgress(trackShare + p * (1 - trackShare));
          setPhase(label);
        },
      });

      setOutputs(result.outputs);
      setSrt(result.captions?.srt ?? null);
      notes.push(...result.notes);
      if (notes.length) setNotice(notes.join(' '));
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
      const aborted = e instanceof RenderAbortedError || controller.signal.aborted;
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
  }, [
    file,
    meta,
    isRendering,
    signedIn,
    targets,
    trackingMode,
    focus,
    splitOn,
    captionsOn,
    captionStyle,
    captionModel,
    trim,
    clipWords,
    usage,
    loadUsage,
    focusAccount,
  ]);

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

  const downloadSrt = () => {
    if (!srt || !file) return;
    const url = URL.createObjectURL(new Blob([srt], { type: 'application/x-subrip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${file.name.replace(/\.[^.]+$/, '') || 'captions'}.srt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
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

  // Preview of the source, shown in the upload card and behind the crop picker.
  const sourceUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    };
  }, [sourceUrl]);
  const [sourcePreviewFailed, setSourcePreviewFailed] = useState(false);
  useEffect(() => setSourcePreviewFailed(false), [sourceUrl]);

  /** Load the landing-page demo clip, framed with Auto-track so it shows off. */
  const [sampleLoading, setSampleLoading] = useState(false);
  const loadSample = useCallback(async () => {
    document.getElementById('studio')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setSampleLoading(true);
    try {
      const res = await fetch(SAMPLE_URL);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      setTrackingMode('smart_face');
      await acceptFile(new File([blob], SAMPLE_NAME, { type: 'video/mp4' }));
    } catch {
      setError('Could not load the sample clip. Check your connection and try again.');
    } finally {
      setSampleLoading(false);
    }
  }, [acceptFile]);

  /** Import from a pasted link (lib/import/client.ts). */
  const [linkUrl, setLinkUrl] = useState('');
  const [linkProgress, setLinkProgress] = useState<number | null>(null);
  const loadFromLink = useCallback(async () => {
    setError(null);
    setLinkProgress(0);
    try {
      const imported = await importFromLink(linkUrl, {
        maxBytes: MAX_FILE_BYTES,
        onProgress: (loaded, total) => setLinkProgress(total ? loaded / total : 0),
      });
      setLinkUrl('');
      await acceptFile(imported);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not import that link.');
    } finally {
      setLinkProgress(null);
    }
  }, [linkUrl, acceptFile]);

  /** Transcribe on this device, then ask the AI for stand-alone clips. */
  const findClipsNow = useCallback(async () => {
    if (!signedIn) {
      focusAccount();
      return;
    }
    if (!file || !meta) return;
    setClipError(null);
    setSuggestions(null);
    try {
      let words = clipWords;
      if (!words) {
        setClipPhase({ label: 'Listening to the audio…', progress: 0 });
        words = await transcribeSource(
          file,
          (pcm, report) =>
            transcribe(pcm, {
              model: captionModel,
              onProgress: (p) =>
                p.stage === 'download'
                  ? report(
                      p.fraction * 0.3,
                      `Getting the speech model ready (one time) · ${formatBytes(p.loadedBytes)} of ${formatBytes(p.totalBytes)}`,
                    )
                  : report(0.3 + p.fraction * 0.7, `Transcribing on your device · ${Math.round(p.fraction * 100)}%`),
            }),
          (f, label) => setClipPhase({ label, progress: f * 0.85 }),
        );
        if (!words) throw new Error('This video has no audio track, so there is nothing to find clips in.');
        setClipWords(words);
      }
      const lines = toLines(words);
      if (lines.length < 3) throw new Error('Not enough speech was found to pick clips from.');
      setClipPhase({ label: 'Picking the best moments…', progress: 0.9 });
      const res = await fetch('/api/clips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ length: clipLength, lines }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Could not find clips right now.');
      setSuggestions(body.clips ?? []);
    } catch (e) {
      setClipError(e instanceof Error ? e.message : 'Could not find clips right now.');
    } finally {
      setClipPhase(null);
    }
  }, [signedIn, focusAccount, file, meta, clipWords, captionModel, clipLength]);

  /** From the landing CTAs: bring the studio into view and open the picker. */
  const startFromCta = () => {
    document.getElementById('studio')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!file) inputRef.current?.click();
  };

  const reset = () => {
    setFile(null);
    setMeta(null);
    setOutputs([]);
    setClipWords(null);
    setSuggestions(null);
    setClipError(null);
    setTrim(null);
    setSrt(null);
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
      <SiteHeader onSignIn={focusAccount} />

      {/* Pitch for first-time visitors. Signed-in users go straight to work. */}
      {!sessionPending && !signedIn && (
        <section className="grid items-center gap-12 pb-4 pt-6 md:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] md:pt-14 lg:gap-16">
          <div>
            <p className="fc-chip-accent">
              <Sparkles className="h-3.5 w-3.5" />
              New: split screen for two-person podcasts
            </p>
            <h1 className="fc-display mt-5 max-w-xl text-5xl font-extrabold leading-[1.02] tracking-tight text-white sm:text-6xl lg:text-7xl">
              One clip in.{' '}
              <span className="fc-gradient-text">Every feed out.</span>
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-zinc-400 sm:text-lg">
              Turn a horizontal video into captioned vertical, square and widescreen cuts that
              keep every speaker in frame, with split screen when two people are talking. Ready
              for TikTok, Reels, Shorts and YouTube in one pass.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                onClick={startFromCta}
                className="fc-btn-primary !min-h-[56px] !px-8 !text-base"
              >
                <Upload className="h-5 w-5" />
                Upload a video — it’s free
              </button>
              <Link href="/pricing" className="fc-btn-ghost !min-h-[44px] justify-center !text-sm">
                See pricing
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-zinc-400">
              {[
                'No watermark',
                'No upload',
                `${formatQuota(TIER_LIMITS.free)} free a month`,
                'No card needed',
              ].map((f) => (
                <li key={f} className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap items-center gap-2">
              <span className="fc-meta mr-1">Made for</span>
              {PLATFORM_PILLS.map((p) => (
                <span
                  key={p.name}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-zinc-300"
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${p.dot}`} />
                  {p.name}
                </span>
              ))}
            </div>
          </div>

          <HeroShowcase />
        </section>
      )}

      {signedIn && session?.user && (
        <div>
          <h1 className="fc-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Hey {displayName(session.user).split(' ')[0]} 👋
          </h1>
          <p className="fc-body mt-1">Drop a video and get every format ready to post.</p>
        </div>
      )}

      {!sessionPending && !signedIn && <RealDemo onSample={() => void loadSample()} />}

      {!sessionPending && !signedIn && <LiveDemo onStart={startFromCta} />}

      {!sessionPending && !signedIn && (
        <div className="pt-10 text-center">
          <h2 className="fc-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Try it right here
          </h2>
          <p className="fc-body mt-2">
            Load a clip and set it up now. You’ll only need a free account to render.
          </p>
        </div>
      )}

      <div id="studio" className="grid scroll-mt-6 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Work column: the render pipeline, in order. */}
        <div className="space-y-5">
      {/* Upload */}
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,video/x-matroska,video/*"
        className="hidden"
        onChange={(e) => void acceptFile(e.target.files?.[0] ?? null)}
      />
      {file && meta ? (
        <div className="fc-card p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative flex aspect-video w-full shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-black ring-1 ring-white/10 sm:w-64">
              {sourceUrl && !sourcePreviewFailed ? (
                <video
                  src={`${sourceUrl}#t=1`}
                  muted
                  playsInline
                  controls
                  preload="metadata"
                  onError={() => setSourcePreviewFailed(true)}
                  className="h-full w-full object-contain"
                />
              ) : (
                <Video className="h-8 w-8 text-zinc-600" />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <p className="fc-meta flex items-center gap-1.5 !text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Loaded on this device
                </p>
                <p className="mt-1 truncate text-base font-semibold text-white" title={file.name}>
                  {file.name}
                </p>
                {trim && (
                  <p className="fc-chip-accent mt-2 w-fit font-mono">
                    <Scissors className="h-3.5 w-3.5" />
                    Clip {formatDuration(trim.start)}–{formatDuration(trim.end)}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="fc-chip font-mono">
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
              {!isRendering && (
                <button
                  onClick={() => {
                    reset();
                    inputRef.current?.click();
                  }}
                  className="fc-btn-ghost -ml-3"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Replace video
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          aria-label="Choose a video to flip"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
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
          className={`relative cursor-pointer rounded-3xl border-2 border-dashed px-6 py-12 text-center transition-all duration-200 sm:py-14 ${
            dragActive
              ? 'scale-[1.01] border-pink-400 bg-pink-500/[0.07]'
              : 'border-white/[0.12] bg-white/[0.02] hover:border-pink-400/50 hover:bg-white/[0.04]'
          } ${isRendering ? 'pointer-events-none opacity-60' : ''}`}
        >
          <div className="flex flex-col items-center gap-3">
            <div className="fc-gradient rounded-2xl p-4 shadow-lg shadow-pink-500/30">
              <Upload className="h-6 w-6 text-white" />
            </div>
            <p className="fc-display text-xl font-bold text-white sm:text-2xl">
              {dragActive ? 'Drop it' : 'Drop your video here'}
            </p>
            <p className="fc-body">
              or <span className="font-semibold text-pink-400">browse your files</span>. It stays
              on your device.
            </p>
            <p className="fc-meta">MP4, MOV, WebM or MKV · up to {formatBytes(MAX_FILE_BYTES)}</p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void loadSample();
              }}
              disabled={sampleLoading}
              className="fc-btn-ghost mt-1 !text-pink-300"
            >
              {sampleLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              No video handy? Try a sample clip
            </button>
          </div>
        </div>
      )}

      {!file && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void loadFromLink();
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <label htmlFor="video-link" className="sr-only">
            Video link
          </label>
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              id="video-link"
              type="url"
              inputMode="url"
              placeholder="Or paste a Dropbox, Google Drive or direct video link"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              disabled={linkProgress !== null || isRendering}
              className="min-h-[44px] w-full rounded-full border border-white/10 bg-white/[0.04] pl-10 pr-4 text-sm text-white placeholder:text-zinc-500 focus:border-pink-400/60 focus:outline-none disabled:opacity-60"
            />
          </div>
          <button
            type="submit"
            disabled={!linkUrl.trim() || linkProgress !== null || isRendering}
            className="fc-btn-secondary shrink-0"
          >
            {linkProgress !== null ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {linkProgress > 0 ? `${Math.round(linkProgress * 100)}%` : 'Fetching…'}
              </>
            ) : (
              'Import'
            )}
          </button>
        </form>
      )}

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

      {/* AI clip finding: for longer videos, pick the moments worth posting. */}
      {file && meta && meta.durationSeconds >= 60 && (
        <div className="fc-card space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="fc-heading flex items-center gap-2">
                <Wand2 className="h-5 w-5 text-pink-400" />
                Find the best clips
                <span className="fc-chip-accent !py-0.5">AI</span>
              </h2>
              <p className="fc-body mt-1 max-w-xl">
                Picks the moments that work on their own. Speech is transcribed on this device;
                only the transcript text is sent to our AI. Your video never leaves it.
              </p>
            </div>
            <div
              role="radiogroup"
              aria-label="Clip length"
              className="inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1"
            >
              {(Object.keys(CLIP_LENGTHS) as ClipLength[]).map((k) => (
                <button
                  key={k}
                  role="radio"
                  aria-checked={clipLength === k}
                  onClick={() => setClipLength(k)}
                  disabled={clipPhase !== null || isRendering}
                  className={`min-h-[36px] rounded-full px-3 text-xs font-semibold transition-colors disabled:opacity-50 ${
                    clipLength === k ? 'bg-white/[0.12] text-white' : 'text-zinc-400 hover:text-zinc-100'
                  }`}
                >
                  {CLIP_LENGTHS[k].label}
                </button>
              ))}
            </div>
          </div>

          {clipPhase ? (
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-sm text-zinc-200">
                <Loader2 className="h-4 w-4 animate-spin text-pink-400" />
                {clipPhase.label}
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                <div className="fc-gradient h-full transition-all" style={{ width: `${Math.round(clipPhase.progress * 100)}%` }} />
              </div>
            </div>
          ) : (
            <button onClick={() => void findClipsNow()} disabled={isRendering} className="fc-btn-primary">
              <Wand2 className="h-4 w-4" />
              {signedIn ? (suggestions ? 'Find clips again' : 'Find clips') : 'Sign in to find clips'}
            </button>
          )}

          {clipError && (
            <div className="fc-notice-error" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{clipError}</span>
            </div>
          )}

          {suggestions && suggestions.length === 0 && (
            <p className="fc-body">No stand-alone moments stood out. Try a different clip length.</p>
          )}

          {suggestions && suggestions.length > 0 && (
            <ul className="space-y-2">
              {suggestions.map((c) => {
                const chosen = trim?.start === c.start && trim?.end === c.end;
                return (
                  <li
                    key={`${c.start}-${c.end}`}
                    className={`rounded-2xl border p-4 transition-colors ${
                      chosen ? 'border-pink-400/70 bg-pink-500/[0.08]' : 'border-white/[0.07] bg-white/[0.02]'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white">{c.title}</p>
                        <p className="fc-meta mt-0.5 font-mono">
                          {formatDuration(c.start)}–{formatDuration(c.end)} · {Math.round(c.end - c.start)} s
                        </p>
                      </div>
                      <span className="fc-chip-accent shrink-0">{c.score}/100</span>
                    </div>
                    {c.hook && <p className="mt-2 text-sm italic text-zinc-300">“{c.hook}”</p>}
                    {c.reason && <p className="fc-meta mt-1">{c.reason}</p>}
                    <button
                      onClick={() => setTrim(chosen ? null : { start: c.start, end: c.end })}
                      disabled={isRendering}
                      className={`mt-3 ${chosen ? 'fc-btn-secondary' : 'fc-btn-primary'} !min-h-[40px]`}
                    >
                      {chosen ? (
                        <>
                          <Check className="h-4 w-4" />
                          Selected · use whole video instead
                        </>
                      ) : (
                        <>
                          <Scissors className="h-4 w-4" />
                          Use this clip
                        </>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Engine params */}
      <section className="space-y-5">
        <div className="fc-card space-y-4 p-5 sm:p-6">
          <StepHeading
            n={1}
            aside={
              <span className="fc-chip-accent shrink-0">
                {targets.length} selected
              </span>
            }
          >
            Formats
          </StepHeading>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {RATIO_OPTIONS.map((ratio) => {
              const active = targets.includes(ratio.id);
              const canvas = outputCanvas(ratio.id, meta?.width, meta?.height);
              const [rw, rh] = ratio.id.split(':').map(Number);
              return (
                <button
                  key={ratio.id}
                  onClick={() => toggleTarget(ratio.id)}
                  disabled={isRendering}
                  aria-pressed={active}
                  className={`group relative flex flex-col items-center gap-2 rounded-2xl border px-2 py-4 text-center transition-all disabled:opacity-50 sm:gap-3 sm:p-4 ${
                    active
                      ? 'border-pink-400/70 bg-pink-500/[0.08] shadow-lg shadow-pink-500/10'
                      : 'border-white/[0.07] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]'
                  }`}
                >
                  <span
                    className={`absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border sm:right-3 sm:top-3 ${
                      active ? 'fc-gradient border-transparent' : 'border-white/20'
                    }`}
                  >
                    {active && <Check className="h-3 w-3 text-white" />}
                  </span>
                  <span className="flex h-14 items-center justify-center sm:h-20">
                    <span
                      className={`rounded-md border-2 transition-colors sm:rounded-lg ${
                        active ? 'fc-gradient border-transparent' : 'border-white/25 bg-white/[0.04]'
                      }`}
                      style={{ width: (48 * rw) / Math.max(rw, rh), height: (48 * rh) / Math.max(rw, rh) }}
                    />
                  </span>
                  <span>
                    <span className="block text-sm font-bold text-white">
                      <span className="sm:hidden">{ratio.id}</span>
                      <span className="hidden sm:inline">{ratio.title}</span>
                    </span>
                    <span className="fc-meta block !text-[11px] sm:!text-xs">{ratio.platforms}</span>
                  </span>
                  <span className="fc-chip hidden font-mono sm:inline-flex">
                    {canvas.w}×{canvas.h}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="fc-card space-y-4 p-5 sm:p-6">
          <StepHeading n={2}>Framing</StepHeading>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODE_OPTIONS.map((mode) => {
              const active = trackingMode === mode.id;
              return (
                <button
                  key={mode.id}
                  onClick={() => setTrackingMode(mode.id)}
                  disabled={isRendering}
                  aria-pressed={active}
                  className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition-all disabled:opacity-50 ${
                    active
                      ? 'border-pink-400/70 bg-pink-500/[0.08]'
                      : 'border-white/[0.07] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]'
                  }`}
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                      active ? 'fc-gradient text-white' : 'bg-white/[0.06] text-zinc-400'
                    }`}
                  >
                    <mode.icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-semibold text-white">
                      {mode.title}
                      {mode.badge && (
                        <span className="rounded-full bg-emerald-500/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-emerald-300">
                          {mode.badge}
                        </span>
                      )}
                    </span>
                    <span className="fc-meta mt-0.5 block !text-zinc-400">{mode.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {trackingMode === 'smart_face' && (
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
              <input
                type="checkbox"
                checked={splitOn}
                onChange={(e) => setSplitOn(e.target.checked)}
                disabled={isRendering}
                className="mt-0.5 h-4 w-4 shrink-0 accent-pink-500"
              />
              <span>
                <span className="block text-sm font-semibold text-white">Split screen for two speakers</span>
                <span className="fc-meta mt-0.5 block !text-zinc-400">
                  Whenever two people are on camera together, the 9:16 cut stacks them top and
                  bottom so neither gets cropped out, and switches back when it cuts to one.
                  Ideal for podcasts and interviews.
                </span>
              </span>
            </label>
          )}

          {trackingMode === 'manual_crop' &&
            (file ? (
              <FocusPicker
                focus={focus}
                onChange={setFocus}
                disabled={isRendering}
                sourceWidth={meta?.width ?? null}
                sourceHeight={meta?.height ?? null}
                ratios={targets}
                previewSrc={sourcePreviewFailed ? null : sourceUrl}
              />
            ) : (
              <p className="fc-meta">Load a video to choose the framing on the real frame.</p>
            ))}
        </div>

        <div className="fc-card space-y-4 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <StepHeading n={3}>
                Captions
                <span className="fc-chip-accent !py-0.5">Free</span>
              </StepHeading>
              <p className="fc-body mt-2">
                Word-by-word captions in dozens of languages, burned into every format, plus an
                .srt file. Transcribed on your device; the speech model downloads once.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={captionsOn}
              aria-label="Auto captions"
              onClick={() => setCaptionsOn((v) => !v)}
              disabled={isRendering}
              className={`relative mt-1 h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                captionsOn ? 'fc-gradient' : 'bg-white/[0.12]'
              }`}
            >
              <span
                className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${
                  captionsOn ? 'left-7' : 'left-1'
                }`}
              />
            </button>
          </div>

          {captionsOn && (
            <div
              role="radiogroup"
              aria-label="Caption accuracy"
              className="grid grid-cols-2 gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-1"
            >
              {(
                [
                  { id: 'fast', name: 'Fast', desc: '77 MB download, quick' },
                  { id: 'accurate', name: 'High accuracy', desc: '249 MB download, slower' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  role="radio"
                  aria-checked={captionModel === m.id}
                  onClick={() => setCaptionModel(m.id)}
                  disabled={isRendering}
                  className={`rounded-xl px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                    captionModel === m.id ? 'bg-white/[0.1]' : 'hover:bg-white/[0.04]'
                  }`}
                >
                  <span className="block text-sm font-semibold text-white">{m.name}</span>
                  <span className="fc-meta block">{m.desc}</span>
                </button>
              ))}
            </div>
          )}

          {captionsOn && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {CAPTION_STYLES.map((st) => (
                <button
                  key={st.id}
                  onClick={() => setCaptionStyle(st.id)}
                  disabled={isRendering}
                  aria-pressed={captionStyle === st.id}
                  title={st.desc}
                  className={`flex flex-col items-center gap-2 rounded-2xl border p-2 text-center transition-all disabled:opacity-50 sm:p-3 ${
                    captionStyle === st.id
                      ? 'border-pink-400/70 bg-pink-500/[0.08]'
                      : 'border-white/[0.07] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]'
                  }`}
                >
                  <CaptionSwatch style={st.id} />
                  <span className="text-sm font-semibold text-white">{st.name}</span>
                  <span className="fc-meta hidden sm:block">{st.desc}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Action */}
      {isRendering ? (
        <div className="fc-card space-y-3 p-5">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-medium text-zinc-200">
              <Loader2 className="h-4 w-4 animate-spin text-pink-400" />
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
            className="h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]"
            role="progressbar"
            aria-valuenow={Math.round(progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Render progress"
          >
            <div
              className="fc-gradient h-full rounded-full transition-all duration-200"
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
          className="fc-gradient fc-display group flex min-h-[56px] w-full items-center justify-center gap-2 rounded-full text-base font-bold text-white shadow-xl shadow-pink-500/25 transition-all hover:brightness-110 active:scale-[0.99] disabled:bg-none disabled:bg-white/[0.06] disabled:text-zinc-600 disabled:shadow-none"
        >
          <Sparkles className="h-4 w-4" />
          {signedIn
            ? targets.length > 1
              ? `Flip it into ${targets.length} formats`
              : 'Flip it'
            : 'Sign in to flip'}
        </button>
      )}

      {/* Outputs */}
      {outputs.length > 0 && (
        <section className="fc-card space-y-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="fc-display flex items-center gap-2 text-2xl font-extrabold text-white">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                Ready to post 🎉
              </h2>
              <p className="fc-meta mt-0.5">
                {outputs.length} {outputs.length === 1 ? 'format' : 'formats'} rendered on your device
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={downloadAll} className="fc-btn-primary">
                Download all
              </button>
              {srt && (
                <button onClick={downloadSrt} className="fc-btn-secondary">
                  Captions .srt
                </button>
              )}
              <button onClick={reset} className="fc-btn-secondary">
                Start over
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {outputs.map((o) => (
              <div
                key={o.ratio}
                className="flex flex-col gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4"
              >
                {/* Shown at the clip's real shape, framed like the screen it is for. */}
                <div className="flex h-72 items-center justify-center rounded-xl bg-black/40 p-3">
                  <video
                    src={previewUrls.get(o.ratio)}
                    className="max-h-full max-w-full rounded-[14px] bg-black shadow-xl shadow-black/50 ring-1 ring-white/10"
                    style={{ aspectRatio: `${o.width} / ${o.height}` }}
                    controls
                    playsInline
                  />
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="fc-display text-base font-bold text-white">{o.ratio}</p>
                  <p className="fc-meta">
                    {o.width}×{o.height} · {formatBytes(o.sizeBytes)}
                  </p>
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
                  className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]"
                  role="progressbar"
                  aria-valuenow={Math.round(usagePercent)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Monthly render time used"
                >
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      usagePercent >= 90 ? 'bg-amber-400' : 'fc-gradient'
                    }`}
                    style={{ width: `${usagePercent}%` }}
                  />
                </div>
                <p className="fc-meta mt-2">
                  {formatQuota(usage.remainingSeconds)} of render time left
                </p>
              </div>

              {usage.tier === 'free' ? (
                <div className="space-y-2 rounded-2xl border border-pink-500/25 bg-gradient-to-br from-pink-500/[0.12] via-fuchsia-500/[0.06] to-orange-400/[0.08] p-4">
                  <p className="fc-display text-base font-bold text-white">Posting more often?</p>
                  <p className="fc-body">
                    Creator gives you {formatQuota(TIER_LIMITS.creator)} a month and clips up to{' '}
                    {MAX_SOURCE_SECONDS.creator / 60} minutes, for less than most cloud tools
                    charge for an hour.
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

          <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-zinc-500">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400/80" />
            Videos are encoded in this tab. Only the file name, duration and format reach our
            server.
          </p>
        </aside>
      </div>

      {!sessionPending && !signedIn && <LandingSections onStart={startFromCta} />}

      <SiteFooter />
    </div>
  );
}