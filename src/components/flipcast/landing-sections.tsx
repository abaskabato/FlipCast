import Link from 'next/link';
import {
  BadgeCheck,
  Captions,
  Check,
  Layers,
  MousePointerClick,
  ScanFace,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
  Zap,
} from 'lucide-react';

import { formatQuota, TIER_LIMITS } from '@/lib/quotas';

const STEPS = [
  {
    icon: Upload,
    title: 'Drop in your video',
    body: 'Any horizontal MP4, MOV, WebM or MKV. It opens in this tab and is never uploaded.',
  },
  {
    icon: MousePointerClick,
    title: 'Pick formats and framing',
    body: 'Choose 9:16, 1:1 and 16:9 at once. Auto-track follows the speaker, or set the framing yourself.',
  },
  {
    icon: Send,
    title: 'Download or post',
    body: 'Every cut renders together. Share straight to TikTok, Reels, Shorts, YouTube, LinkedIn or X.',
  },
];

const FEATURES = [
  {
    icon: ScanFace,
    title: 'Auto-track',
    body: 'Face detection finds the speaker in every shot and glides the crop with them, with no jitter.',
  },
  {
    icon: Captions,
    title: 'Word-by-word captions',
    body: 'Whisper transcribes on your device. Three burn-in styles, plus an .srt file for any editor.',
  },
  {
    icon: Layers,
    title: 'Every format in one pass',
    body: 'Vertical, square and widescreen from a single render, sized to the detail your source has.',
  },
  {
    icon: ShieldCheck,
    title: 'Private by design',
    body: 'Rendering runs in your browser. Unreleased or client footage never touches a server.',
  },
  {
    icon: BadgeCheck,
    title: 'No watermark, ever',
    body: 'Not on Free, not on any plan. Your clips go out looking like yours.',
  },
  {
    icon: Zap,
    title: 'No upload, no queue',
    body: 'Skip the progress bar for a 2 GB upload and the wait behind other people’s renders.',
  },
];

/** Structural differences only: things that follow from rendering on-device. */
const COMPARISON: { label: string; us: boolean; cloud: boolean | 'varies' }[] = [
  { label: 'Footage stays on your device', us: true, cloud: false },
  { label: 'Starts instantly, no upload wait', us: true, cloud: false },
  { label: 'No watermark on the free plan', us: true, cloud: 'varies' },
  { label: 'Auto-track and captions included free', us: true, cloud: 'varies' },
  { label: 'All formats from one render', us: true, cloud: 'varies' },
];

function Mark({ value }: { value: boolean | 'varies' }) {
  if (value === 'varies') return <span className="text-xs font-semibold text-zinc-500">Often paid</span>;
  return value ? (
    <Check className="mx-auto h-5 w-5 text-emerald-400" aria-label="Yes" />
  ) : (
    <X className="mx-auto h-5 w-5 text-zinc-600" aria-label="No" />
  );
}

export default function LandingSections({ onStart }: { onStart: () => void }) {
  return (
    <div className="space-y-24 pt-16">
      <section aria-labelledby="how">
        <p className="fc-chip-accent mx-auto w-fit">How it works</p>
        <h2 id="how" className="fc-display mt-4 text-center text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Three steps. Every platform.
        </h2>
        <ol className="mt-10 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="fc-card relative p-6">
              <span className="fc-display absolute right-5 top-4 text-5xl font-extrabold text-white/[0.06]">
                {i + 1}
              </span>
              <span className="fc-gradient inline-flex rounded-2xl p-3 shadow-lg shadow-pink-500/20">
                <s.icon className="h-5 w-5 text-white" />
              </span>
              <h3 className="fc-heading mt-4">{s.title}</h3>
              <p className="fc-body mt-1.5">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="features">
        <h2 id="features" className="fc-display text-center text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Everything a repurposing tool should do. <span className="fc-gradient-text">Nothing it shouldn’t.</span>
        </h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="fc-card p-6 transition-colors hover:border-pink-400/30">
              <f.icon className="h-6 w-6 text-pink-400" />
              <h3 className="fc-heading mt-3">{f.title}</h3>
              <p className="fc-body mt-1.5">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="compare" className="mx-auto max-w-3xl">
        <h2 id="compare" className="fc-display text-center text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Why render in the browser?
        </h2>
        <div className="fc-card mt-8 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-left">
                <th className="p-4 font-medium text-zinc-500" scope="col">
                  <span className="sr-only">Feature</span>
                </th>
                <th className="w-28 p-4 text-center font-bold text-white sm:w-36" scope="col">
                  Flipcast
                </th>
                <th className="w-28 p-4 text-center font-medium text-zinc-400 sm:w-36" scope="col">
                  Cloud editors
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row) => (
                <tr key={row.label} className="border-b border-white/[0.04] last:border-0">
                  <th scope="row" className="p-4 text-left font-medium text-zinc-200">
                    {row.label}
                  </th>
                  <td className="bg-pink-500/[0.05] p-4 text-center">
                    <Mark value={row.us} />
                  </td>
                  <td className="p-4 text-center">
                    <Mark value={row.cloud} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="relative overflow-hidden rounded-[2rem] border border-pink-500/25 bg-gradient-to-br from-pink-500/[0.16] via-fuchsia-500/[0.08] to-orange-400/[0.12] px-6 py-14 text-center">
        <h2 className="fc-display text-3xl font-extrabold tracking-tight text-white sm:text-5xl">
          Your next post is one drop away.
        </h2>
        <p className="fc-body mx-auto mt-3 max-w-md !text-zinc-300">
          {formatQuota(TIER_LIMITS.free)} free every month. No card, no watermark, no upload.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <button onClick={onStart} className="fc-btn-primary !min-h-[52px] !px-7 !text-base">
            <Sparkles className="h-4 w-4" />
            Flip a video free
          </button>
          <Link href="/pricing" className="fc-btn-secondary !min-h-[52px] !px-7 !text-base">
            See pricing
          </Link>
        </div>
      </section>
    </div>
  );
}
