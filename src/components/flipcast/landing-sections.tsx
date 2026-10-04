import Link from 'next/link';
import {
  Captions,
  Check,
  Layers,
  ScanFace,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
  Rows2,
  Wand2,
  CalendarClock,
  Link2,
  ChevronDown,
} from 'lucide-react';

import type { Features } from '@/lib/features-client';
import { BROWSER_MAX_INPUT_BYTES, formatQuota, MAX_SOURCE_SECONDS, TIER_LIMITS } from '@/lib/quotas';

type Item = { icon: typeof Upload; title: string; body: string };

/** The three steps, worded for what this deployment actually offers. */
function steps(f: Features): Item[] {
  return [
    {
      icon: Upload,
      title: 'Drop in or link your video',
      body: 'Any MP4, MOV, WebM or MKV, from your device or a Dropbox or Google Drive link. It is processed in this tab.',
    },
    {
      icon: Wand2,
      title: 'Pick the moments and formats',
      body: `${f.clips ? 'AI suggests' : 'Flipcast suggests'} the clips worth posting from a long video; choose 9:16, 1:1 and 16:9, with Auto-track on every one.`,
    },
    f.youtube || f.tiktok
      ? {
          icon: CalendarClock,
          title: 'Post or schedule',
          body: 'Publish to YouTube and TikTok now or at a set time, or download every cut to post anywhere.',
        }
      : {
          icon: Send,
          title: 'Download or post',
          body: 'Every cut renders together. Share straight to TikTok, Reels, Shorts, YouTube, LinkedIn or X.',
        },
  ];
}

/** Feature cards; the optional ones appear only once switched on. */
function features(f: Features): Item[] {
  return [
    f.clips
      ? { icon: Wand2, title: 'AI finds the best clips', body: 'Drop in a podcast or long video and get stand-alone moments, titled and ranked. Your video stays on your device; only the transcript is analysed.' }
      : { icon: Wand2, title: 'Finds the best clips', body: 'Drop in a podcast or long video and get stand-alone moments, titled and ranked by their hook and how cleanly they end. Found on your device, so nothing is uploaded.' },
    { icon: ScanFace, title: 'Auto-track', body: 'Face detection finds the speaker in every shot and glides the crop with them, with no jitter.' },
    { icon: Rows2, title: 'Split screen for podcasts', body: 'Two people on camera? The vertical cut stacks both speakers while they are on screen together, and switches back when it cuts to one.' },
    { icon: Captions, title: 'Captions in any language', body: 'Word-by-word captions in dozens of languages and every script, from Hindi to Japanese to Arabic. Five styles, plus an .srt file.' },
    { icon: Layers, title: 'Every format in one pass', body: 'Vertical, square and widescreen from a single render, sized to the detail your source has.' },
    { icon: Link2, title: 'Import from a link', body: 'Paste a Dropbox, Google Drive or direct video link instead of downloading and re-uploading.' },
    ...(f.youtube || f.tiktok
      ? [{ icon: CalendarClock, title: 'Publish and schedule', body: `Post straight to ${[f.youtube && 'YouTube', f.tiktok && 'TikTok'].filter(Boolean).join(' and ')}, now or at the time your audience is online.` }]
      : []),
    { icon: ShieldCheck, title: 'Private, no watermark', body: 'Rendering runs in your browser, so footage never touches a server. No watermark on any plan, including Free.' },
  ];
}

/** Questions people ask before they try it. */
function faq(f: Features): { q: string; a: string }[] {
  return [
    { q: 'Is it really free?', a: `Yes. Free includes ${formatQuota(TIER_LIMITS.free)} of video a month, every format, Auto-track and captions, with no watermark and no card. Paid plans add hours, not features.` },
    { q: 'Do you upload my video?', a: `No. Rendering and transcription run in your browser, so your footage stays on your device.${f.clips ? ' Finding clips sends only the transcript text to our AI.' : ''}${f.tiktokScheduling ? ' A TikTok post you schedule for later is held privately until it goes out, then deleted.' : ''}` },
    { q: 'Which languages do captions support?', a: 'Dozens, detected automatically, including Spanish, Portuguese, French, German, Hindi, Arabic, Japanese, Korean and Chinese, each drawn in a font made for its script.' },
    { q: 'How long can my videos be?', a: `Load a video of any length up to ${Math.round(BROWSER_MAX_INPUT_BYTES / 1024 / 1024)} MB (it is processed in your browser) and cut clips from it. Each render can be up to ${MAX_SOURCE_SECONDS.free / 60} minutes on Free, ${MAX_SOURCE_SECONDS.creator / 60} on Creator and ${MAX_SOURCE_SECONDS.agency / 60} on Agency.` },
    { q: 'Can it find clips in a long video?', a: `Yes. Load a video over a minute long and choose "Find clips". ${f.clips ? 'AI suggests' : 'Flipcast suggests'} stand-alone moments of the length you pick; render the ones you like.${f.clips ? '' : ' The picks are made on your device.'}` },
    ...(f.youtube || f.tiktok ? [{ q: 'Can I post straight to social media?', a: `Yes: connect ${[f.youtube && 'YouTube', f.tiktok && 'TikTok'].filter(Boolean).join(' and ')} and post or schedule from the finished clip. Everything else can be downloaded or shared to any app.` }] : []),
    { q: 'What does it run on?', a: 'Any recent desktop browser, and most phones. A faster computer renders faster, because the work happens on your device.' },
  ];
}

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

export default function LandingSections({ onStart, features: live }: { onStart: () => void; features: Features }) {
  const STEPS = steps(live);
  const FEATURES = features(live);
  const FAQ = faq(live);
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

      <section aria-labelledby="faq" className="mx-auto max-w-3xl">
        <h2 id="faq" className="fc-display text-center text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Questions
        </h2>
        <div className="mt-8 space-y-2">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="fc-card group p-0 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-4 px-5 text-left text-base font-semibold text-white">
                {q}
                <ChevronDown className="h-5 w-5 shrink-0 text-zinc-500 transition-transform group-open:rotate-180" />
              </summary>
              <p className="fc-body px-5 pb-5">{a}</p>
            </details>
          ))}
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
