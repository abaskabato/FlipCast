import Link from 'next/link';
import { ArrowRight, Briefcase, Building2, Check, GraduationCap, Lock, Mic, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';

import type { Features } from '@/lib/features-client';
import { formatQuota, TIER_LIMITS } from '@/lib/quotas';

/**
 * Marketing sections in the style of the big clipping tools (feature rows with
 * a picture each, use cases, a proof band), built honestly: no invented user
 * counts, logos or reviews, only facts a visitor can check. The pictures are
 * drawn in HTML so they stay sharp and weigh nothing.
 */

/** Checkable facts under the hero, where others put user counts. */
export function TrustBand() {
  const facts = [
    { value: '0 bytes', label: 'of your video uploaded' },
    { value: '0', label: 'watermarks, on every plan' },
    { value: '3 formats', label: 'from a single render' },
    { value: formatQuota(TIER_LIMITS.free), label: 'free every month, no card' },
  ];
  return (
    <section aria-label="Why Flipcast" className="fc-card mt-12 px-5 py-6 sm:px-8">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-5 md:grid-cols-4">
        {facts.map((f) => (
          <div key={f.label} className="text-center">
            <dt className="sr-only">{f.label}</dt>
            <dd className="fc-display fc-gradient-text text-3xl font-extrabold tracking-tight sm:text-4xl">{f.value}</dd>
            <dd className="fc-meta mt-1">{f.label}</dd>
          </div>
        ))}
      </dl>
      <p className="fc-meta mt-5 border-t border-white/[0.06] pt-4 text-center">
        Built on open source: FFmpeg for video, OpenAI&apos;s Whisper for speech, Google&apos;s MediaPipe for faces.
        All of it runs in your browser.
      </p>
    </section>
  );
}

// ---- pictures for the feature rows ------------------------------------------

function SuggestionsMock({ ai }: { ai: boolean }) {
  const clips = [
    { title: 'Why most startups fail in year one', time: '04:12–04:39', score: 95 },
    { title: 'The pricing mistake nobody talks about', time: '17:05–17:31', score: 91 },
    { title: 'Talk to ten customers first', time: '31:48–32:10', score: 87 },
  ];
  return (
    <div className="fc-card space-y-2.5 p-4 shadow-2xl shadow-black/40">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-white">Find the best clips</p>
        <span className="fc-chip-accent !py-0.5 text-[11px]">{ai ? 'AI' : 'On device'}</span>
      </div>
      {clips.map((c) => (
        <div key={c.title} className="flex items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-pink-500">
            <Check className="h-3 w-3 text-white" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{c.title}</p>
            <p className="fc-meta font-mono">{c.time}</p>
          </div>
          <span className="fc-chip-accent shrink-0 !py-0.5 text-[11px]">{c.score}/100</span>
        </div>
      ))}
      <div className="fc-gradient flex min-h-[40px] items-center justify-center rounded-full text-sm font-semibold text-white">
        Render 3 clips
      </div>
    </div>
  );
}

function FormatsMock() {
  const shapes = [
    { label: '9:16', cls: 'aspect-[9/16] w-[26%]' },
    { label: '1:1', cls: 'aspect-square w-[34%]' },
    { label: '16:9', cls: 'aspect-video w-[40%]' },
  ];
  return (
    <div className="fc-card space-y-3 p-4 shadow-2xl shadow-black/40">
      {[1, 2].map((n) => (
        <div key={n}>
          <p className="fc-meta mb-1.5">Clip {n}</p>
          <div className="flex items-end gap-2">
            {shapes.map((s) => (
              <div
                key={s.label}
                className={`${s.cls} flex items-end justify-center rounded-lg border border-white/10 bg-gradient-to-br from-pink-500/30 via-fuchsia-500/20 to-orange-400/25 pb-1.5`}
              >
                <span className="rounded-full bg-black/50 px-1.5 font-mono text-[10px] text-white">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="fc-meta flex items-center gap-1.5">
        <Check className="h-3.5 w-3.5 text-emerald-400" /> 6 files ready · Download all
      </p>
    </div>
  );
}

function CaptionsMock() {
  const langs = ['English', 'Español', 'हिन्दी', '日本語', 'العربية', 'Français'];
  return (
    <div className="fc-card flex gap-4 p-4 shadow-2xl shadow-black/40">
      <div className="relative aspect-[9/16] w-[38%] shrink-0 overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-zinc-700 to-zinc-900">
        <div className="absolute inset-x-2 bottom-[22%] text-center font-display text-[15px] font-extrabold uppercase leading-tight tracking-tight text-white [text-shadow:0_2px_0_#000,0_0_6px_rgba(0,0,0,.6)]">
          Talk to <span className="text-yellow-300">ten</span> customers
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {langs.map((l) => (
            <span key={l} className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-zinc-300">
              {l}
            </span>
          ))}
        </div>
        <div className="space-y-1.5">
          <p className="fc-meta">Check the words</p>
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-xs text-zinc-400 line-through decoration-red-400/70">
            Talk to ten customers before you right code
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-pink-400/50 bg-white/[0.06] px-2.5 py-1.5 text-xs text-zinc-100">
            <Pencil className="h-3 w-3 shrink-0 text-pink-400" />
            Talk to ten customers before you write code
          </div>
        </div>
      </div>
    </div>
  );
}

function PrivacyMock() {
  return (
    <div className="fc-card overflow-hidden p-0 shadow-2xl shadow-black/40">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
        <span className="ml-3 flex items-center gap-1.5 rounded-full bg-white/[0.05] px-3 py-1 text-[11px] text-zinc-400">
          <Lock className="h-3 w-3" /> flipcast.dev
        </span>
      </div>
      <div className="space-y-4 p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-200">Rendering on this device · 64%</span>
          <span className="fc-meta">podcast-ep12.mp4</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="fc-gradient h-full w-[64%] rounded-full" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3 text-center">
            <p className="fc-display text-2xl font-extrabold text-white">0 B</p>
            <p className="fc-meta">uploaded</p>
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3 text-center">
            <p className="fc-display text-2xl font-extrabold text-white">0 s</p>
            <p className="fc-meta">in a queue</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- feature rows ---------------------------------------------------------

function Row({ eyebrow, title, body, points, picture, flip }: { eyebrow: string; title: ReactNode; body: string; points: string[]; picture: ReactNode; flip?: boolean }) {
  return (
    <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-2 md:gap-14">
      <div className={`min-w-0 ${flip ? 'md:order-2' : ''}`}>
        <p className="fc-chip-accent w-fit">{eyebrow}</p>
        <h3 className="fc-display mt-4 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">{title}</h3>
        <p className="fc-body mt-3 text-base">{body}</p>
        <ul className="mt-4 space-y-2">
          {points.map((p) => (
            <li key={p} className="flex gap-2.5 text-sm text-zinc-300">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              {p}
            </li>
          ))}
        </ul>
      </div>
      <div className={`mx-auto w-full min-w-0 max-w-md ${flip ? 'md:order-1' : ''}`}>{picture}</div>
    </div>
  );
}

/** The four things Flipcast does best, each with a picture, like the big tools do it. */
export function FeatureRows({ live }: { live: Features }) {
  return (
    <section aria-labelledby="features-title" id="features" className="scroll-mt-8">
      <h2 id="features-title" className="fc-display text-center text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
        Everything a clipping tool should do. <span className="fc-gradient-text">Nothing it shouldn’t.</span>
      </h2>
      <div className="mt-14 space-y-20">
        <Row
          eyebrow="Clip finding"
          title="Finds the moments worth posting"
          body={`Drop in a podcast, webinar or talk. Flipcast ranks every stretch by its hook, whether it starts and ends on a complete thought, and its pacing, then titles the best ones${live.clips ? '' : ', right on your device'}.`}
          points={['Choose 15–30, 30–60 or 60–90 second clips', 'A score and a reason for every pick', 'Works on long videos in any language']}
          picture={<SuggestionsMock ai={live.clips} />}
        />
        <Row
          flip
          eyebrow="Batch export"
          title="Every clip, every format, one click"
          body="Tick the clips you like and Flipcast renders them all: vertical for TikTok, Reels and Shorts, square for Instagram and LinkedIn, widescreen for YouTube and X."
          points={['No credits and no queue', 'Auto-track and split screen on every clip', 'One button downloads everything']}
          picture={<FormatsMock />}
        />
        <Row
          eyebrow="Captions"
          title="Captions in any language, and you can fix them"
          body="Word-by-word captions in the language that is spoken, each script in a font made for it. Correct a name or a misheard word before you render."
          points={['Five styles, plus an .srt file', 'Language detected automatically', 'Edits apply to every clip and format']}
          picture={<CaptionsMock />}
        />
        <Row
          flip
          eyebrow="Private by design"
          title="Your footage never leaves your device"
          body="Rendering, transcription and tracking all run in your browser. Nothing is uploaded, nothing waits in a queue, and no plan adds a watermark."
          points={['Safe for client and unreleased footage', 'Your files are yours: nothing expires', `${formatQuota(TIER_LIMITS.free)} free every month, no card`]}
          picture={<PrivacyMock />}
        />
      </div>
    </section>
  );
}

/** Who it is for, with the angle that matters to each. */
export function UseCases() {
  const cases = [
    { icon: Mic, title: 'Podcasters', body: 'Turn each episode into a week of clips. Split screen keeps both hosts in frame.', href: '/podcast-clip-maker' },
    { icon: GraduationCap, title: 'Coaches and educators', body: 'Cut lessons and webinars into short tips, captioned in the language your audience speaks.' },
    { icon: Briefcase, title: 'Agencies', body: "Client footage stays on your laptop. Every clip in every format at once, with no watermark to explain." },
    { icon: Building2, title: 'Businesses', body: 'Product demos, talks and interviews become posts for LinkedIn, Shorts and Reels without sending anything to a third party.' },
  ];
  return (
    <section aria-labelledby="use-cases-title" id="use-cases" className="scroll-mt-8">
      <h2 id="use-cases-title" className="fc-display text-center text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
        Made for people who talk on camera
      </h2>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cases.map((c) => (
          <div key={c.title} className="fc-card flex flex-col p-6">
            <span className="fc-gradient inline-flex w-fit rounded-2xl p-3 shadow-lg shadow-pink-500/20">
              <c.icon className="h-5 w-5 text-white" />
            </span>
            <h3 className="fc-heading mt-4">{c.title}</h3>
            <p className="fc-body mt-1.5 flex-1">{c.body}</p>
            {c.href && (
              <Link href={c.href} className="fc-link mt-3 inline-flex items-center gap-1 text-sm">
                Clips for podcasts <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
