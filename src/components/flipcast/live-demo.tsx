'use client';

import { useEffect, useRef, useState } from 'react';
import { Pause, Play, ScanFace, Focus as FocusIcon, Upload } from 'lucide-react';

/**
 * An interactive stand-in for the real pipeline, so visitors can feel what
 * Auto-track and captions do before they have a clip to hand.
 *
 * A speaker paces across a 16:9 "master". The output on the right is a true
 * crop of the same scene (one scene, translated), so switching to Centre shows
 * exactly the failure Auto-track fixes: the speaker walks out of shot.
 */

type DemoRatio = '9:16' | '1:1' | '16:9';
type DemoMode = 'track' | 'centre';
type DemoCaption = 'bold' | 'pop' | 'clean' | 'off';

const LOOP_SECONDS = 9;
const RATIO_W: Record<DemoRatio, number> = { '9:16': 9 / 16, '1:1': 1, '16:9': 16 / 9 };
/** Crop window width as a fraction of the 16:9 source. */
const windowWidth = (r: DemoRatio) => RATIO_W[r] / (16 / 9);

/** Speaker centre across the frame at time t: paces wide, pauses at each end. */
function subjectAt(t: number): number {
  const phase = (t % LOOP_SECONDS) / LOOP_SECONDS;
  const eased = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI);
  return 0.2 + 0.6 * eased;
}

const LINES = [
  ['ONE', 'CLIP', 'IN'],
  ['EVERY', 'FEED', 'OUT'],
  ['NO', 'UPLOAD', 'NEEDED'],
];
const WORD_SECONDS = 0.5;

/** The studio. Everything is in % of the frame, so it scales into any crop. */
function Scene({ x }: { x: number }) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-gradient-to-br from-indigo-950 via-fuchsia-950 to-orange-950">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_25%,rgb(251_146_60/0.35),transparent_40%)]" />
      {/* Set dressing, so the crop visibly moves through a place. */}
      <div className="absolute left-[6%] top-[12%] h-[46%] w-[18%] rounded-sm border border-white/10 bg-sky-300/10">
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/10" />
      </div>
      <div className="absolute right-[8%] top-[18%] h-[22%] w-[10%] rounded-sm bg-amber-400/20 ring-1 ring-amber-300/20" />
      <div className="absolute bottom-[22%] right-[30%] h-[34%] w-[1.2%] bg-zinc-500/40" />
      <div className="absolute bottom-[56%] right-[27.5%] h-[6%] w-[6%] rounded-t-full bg-amber-200/40" />
      <div className="absolute bottom-0 left-0 right-0 h-[22%] bg-black/35" />
      {/* The speaker. */}
      <div className="absolute bottom-0 w-[16%] -translate-x-1/2" style={{ left: `${x * 100}%` }}>
        <div className="mx-auto aspect-square w-[44%] rounded-full bg-gradient-to-b from-amber-200 to-amber-300" />
        <div className="mx-auto -mt-[2%] aspect-[4/3] w-full rounded-t-[45%] bg-gradient-to-b from-pink-500 to-fuchsia-700" />
      </div>
    </div>
  );
}

function Captions({ t, style }: { t: number; style: DemoCaption }) {
  if (style === 'off') return null;
  const wordIndex = Math.floor((t % (LINES.length * 3 * WORD_SECONDS)) / WORD_SECONDS);
  const line = LINES[Math.floor(wordIndex / 3)];
  const hot = wordIndex % 3;
  const outline = { textShadow: '0 0 3px #000, 0 0 3px #000, 2px 2px 0 #000' };
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[7%] flex justify-center px-[6%]">
      <p
        className={`font-display text-center font-extrabold uppercase leading-none tracking-tight ${
          style === 'clean' ? 'rounded-md bg-black/55 px-[0.4em] py-[0.15em] text-white' : ''
        }`}
        style={{ fontSize: 'max(11px, 9cqw)', ...(style === 'clean' ? {} : outline) }}
      >
        {line.map((w, i) => (
          <span
            key={w}
            className={
              style === 'clean'
                ? 'text-white'
                : i === hot
                  ? style === 'bold'
                    ? 'text-yellow-300'
                    : 'text-pink-500'
                  : 'text-white'
            }
          >
            {w}
            {i < line.length - 1 ? ' ' : ''}
          </span>
        ))}
      </p>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: React.ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <p className="fc-meta mb-1.5">{label}</p>
      <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1">
        {options.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onChange(o.id)}
            className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors sm:text-sm ${
              value === o.id ? 'fc-gradient text-white shadow' : 'text-zinc-400 hover:text-zinc-100'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function LiveDemo({ onStart }: { onStart: () => void }) {
  const [ratio, setRatio] = useState<DemoRatio>('9:16');
  const [mode, setMode] = useState<DemoMode>('track');
  const [caption, setCaption] = useState<DemoCaption>('bold');
  const [playing, setPlaying] = useState(true);
  // Time, and where the virtual camera is pointing (crop centre, 0..1).
  const [frame, setFrame] = useState(() => {
    const t = LOOP_SECONDS * 0.15;
    return { t, cam: subjectAt(t) };
  });

  const rootRef = useRef<HTMLDivElement>(null);
  const visible = useRef(true);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Respect reduced motion: start paused on a frame that still tells the story.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPlaying(false);
  }, []);

  // Only animate while on screen.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => (visible.current = e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (visible.current) {
        setFrame((f) => {
          const t = f.t + dt;
          // Auto-track eases toward the speaker like the real smoothed path.
          if (modeRef.current === 'centre') return { t, cam: 0.5 };
          return { t, cam: f.cam + (subjectAt(t) - f.cam) * (1 - Math.exp(-dt * 6)) };
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const { t } = frame;
  const subject = subjectAt(t);
  const w = windowWidth(ratio);

  // While paused there is no tick to ease the camera, so snap it.
  const cam = playing ? frame.cam : mode === 'track' ? subject : 0.5;
  const centre = Math.min(1 - w / 2, Math.max(w / 2, cam));
  const left = centre - w / 2;

  const inShot = subject > left + 0.04 && subject < left + w - 0.04;

  return (
    <section ref={rootRef} aria-labelledby="demo" className="pt-16">
      <div className="text-center">
        <p className="fc-chip-accent mx-auto w-fit">Play with it</p>
        <h2 id="demo" className="fc-display mt-4 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Every format, every caption style
        </h2>
        <p className="fc-body mx-auto mt-2 max-w-xl">
          Flip between shapes, framing and caption styles to see how they combine. Switch to
          Centre and watch what happens when the speaker moves.
        </p>
      </div>

      <div className="fc-card mt-8 p-4 sm:p-6">
        <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
          {/* Source with the live crop window. */}
          <div>
            <p className="fc-meta mb-2 flex items-center justify-between">
              <span>Your 16:9 video</span>
              <span className="font-mono">1920×1080</span>
            </p>
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl ring-1 ring-white/10">
              <Scene x={subject} />
              <div
                className="absolute inset-y-0 rounded-md border-2 border-pink-400"
                style={{ left: `${left * 100}%`, width: `${w * 100}%`, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)' }}
              >
                <span className="absolute -top-px left-1/2 -translate-x-1/2 whitespace-nowrap rounded-b-md bg-pink-500 px-2 py-0.5 text-[11px] font-bold text-white">
                  {ratio} {mode === 'track' ? '· tracking' : '· centred'}
                </span>
              </div>
            </div>
          </div>

          {/* The output: a true crop of the same scene. */}
          <div className="flex flex-col items-center">
            <p className="fc-meta mb-2">Output · {ratio}</p>
            <div
              className="relative overflow-hidden rounded-[22px] border-[4px] border-zinc-800 bg-black shadow-2xl shadow-black/60 ring-1 ring-white/15"
              style={{
                height: ratio === '16:9' ? 'auto' : 'min(420px, 70vw)',
                width: ratio === '16:9' ? 'min(420px, 80vw)' : undefined,
                aspectRatio: ratio.replace(':', ' / '),
                containerType: 'inline-size',
              }}
            >
              <div
                className="absolute inset-y-0"
                style={{ width: `${100 / w}%`, left: `${(-left / w) * 100}%` }}
              >
                <Scene x={subject} />
              </div>
              <Captions t={t} style={caption} />
              <span
                className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-semibold backdrop-blur ${
                  inShot ? 'bg-emerald-500/25 text-emerald-200' : 'bg-red-500/30 text-red-100'
                }`}
              >
                {inShot ? '● Speaker in frame' : '● Speaker out of shot'}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-end gap-x-6 gap-y-4 border-t border-white/[0.06] pt-5">
          <Segmented
            label="Framing"
            value={mode}
            onChange={setMode}
            options={[
              { id: 'track', label: <><ScanFace className="h-3.5 w-3.5" />Auto-track</> },
              { id: 'centre', label: <><FocusIcon className="h-3.5 w-3.5" />Centre</> },
            ]}
          />
          <Segmented
            label="Format"
            value={ratio}
            onChange={setRatio}
            options={(['9:16', '1:1', '16:9'] as const).map((r) => ({ id: r, label: r }))}
          />
          <Segmented
            label="Captions"
            value={caption}
            onChange={setCaption}
            options={[
              { id: 'bold', label: 'Bold' },
              { id: 'pop', label: 'Pop' },
              { id: 'clean', label: 'Clean' },
              { id: 'off', label: 'Off' },
            ]}
          />
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => setPlaying((p) => !p)}
              className="fc-btn-secondary !min-h-[44px] !px-4"
              aria-label={playing ? 'Pause demo' : 'Play demo'}
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <button onClick={onStart} className="fc-btn-primary">
              <Upload className="h-4 w-4" />
              Try it on your video
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
