'use client';

import { useEffect, useRef, useState } from 'react';
import { Pause, Play, ScanFace, Upload, XCircle } from 'lucide-react';

/**
 * Real footage, real output. Every vertical clip here is an unedited Flipcast
 * render of its source (see public/demo/CREDITS.txt), shown next to a plain
 * centre crop of the same clip. They play in lockstep so the difference is
 * impossible to miss.
 *
 * Two comparisons: the hero shows split screen on a locked-off two-shot, and
 * the section below shows Auto-track following a camera that pans between
 * the same two speakers.
 */

const SRC = '/demo/podcast-source';
const CENTRE = '/demo/podcast-centre';
const TRACKED = '/demo/podcast-tracked';

const TWO_SRC = '/demo/twoshot-source';
const TWO_CENTRE = '/demo/twoshot-centre';
const TWO_SPLIT = '/demo/twoshot-split';

const TWO_CREDIT = 'https://www.pexels.com/video/a-man-interviewing-a-woman-6878737/';

/** Followers drift on loop and on slow devices; pull them back to the master. */
const MAX_DRIFT = 0.15;

function Phone({
  base,
  label,
  good,
  videoRef,
}: {
  base: string;
  label: string;
  good: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  return (
    <figure className="flex flex-col items-center gap-2.5">
      <div className="relative aspect-[9/16] w-full overflow-hidden rounded-[20px] border-[4px] border-zinc-800 bg-black shadow-2xl shadow-black/60 ring-1 ring-white/15">
        <video
          ref={videoRef}
          src={`${base}.mp4`}
          poster={`${base}.jpg`}
          muted
          playsInline
          loop
          preload="none"
          aria-hidden="true"
          className="h-full w-full object-cover"
        />
      </div>
      <figcaption
        className={`inline-flex items-center gap-1.5 text-center text-xs font-semibold sm:text-sm ${
          good ? 'text-emerald-300' : 'text-red-300'
        }`}
      >
        {good ? <ScanFace className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
        {label}
      </figcaption>
    </figure>
  );
}

/**
 * Play a source and its two outputs together: autoplay while `root` is on
 * screen (unless reduced motion is preferred), keep the outputs on the
 * source's clock, and let the visitor pause.
 */
function useComparePlayback(root: React.RefObject<HTMLElement | null>) {
  const source = useRef<HTMLVideoElement>(null);
  const centre = useRef<HTMLVideoElement>(null);
  const output = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  // Set once the visitor pauses, so scrolling back does not override them.
  const userPaused = useRef(false);

  const all = () => [source.current, centre.current, output.current].filter(Boolean) as HTMLVideoElement[];

  const play = () => {
    const [master, ...rest] = all();
    if (!master) return;
    for (const v of rest) v.currentTime = master.currentTime;
    void Promise.all(all().map((v) => v.play().catch(() => undefined))).then(() => setPlaying(!master.paused));
  };
  const pause = () => {
    all().forEach((v) => v.pause());
    setPlaying(false);
  };

  // Keep the outputs on the source's clock.
  useEffect(() => {
    const master = source.current;
    if (!master) return;
    const sync = () => {
      for (const v of [centre.current, output.current]) {
        if (v && Math.abs(v.currentTime - master.currentTime) > MAX_DRIFT) v.currentTime = master.currentTime;
      }
    };
    master.addEventListener('timeupdate', sync);
    master.addEventListener('seeked', sync);
    return () => {
      master.removeEventListener('timeupdate', sync);
      master.removeEventListener('seeked', sync);
    };
  }, []);

  // Autoplay while on screen, unless the visitor prefers reduced motion.
  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !userPaused.current) play();
        else if (!e.isIntersecting) pause();
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
    // play/pause only touch refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = () => {
    userPaused.current = playing;
    if (playing) pause();
    else play();
  };
  return { source, centre, output, playing, toggle };
}

function PlayToggle({
  playing,
  onToggle,
  className = 'bottom-3 left-3',
}: {
  playing: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onToggle}
      aria-label={playing ? 'Pause comparison' : 'Play comparison'}
      className={`absolute ${className} flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition-colors hover:bg-black/80`}
    >
      {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
    </button>
  );
}

export default function RealDemo({ onSample }: { onSample: () => void }) {
  const root = useRef<HTMLElement>(null);
  const { source, centre, output, playing, toggle } = useComparePlayback(root);

  return (
    <section ref={root} aria-labelledby="real-demo" className="pt-16">
      <div className="text-center">
        <p className="fc-chip-accent mx-auto w-fit">Auto-track · real footage</p>
        <h2 id="real-demo" className="fc-display mt-4 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Same clip. <span className="fc-gradient-text">Two very different Shorts.</span>
        </h2>
        <p className="fc-body mx-auto mt-2 max-w-xl">
          The camera pans from one host to the other. A plain centre crop slices both of them in
          half. Auto-track finds each face and frames it, even across the camera move.
        </p>
      </div>

      <div className="fc-card mt-8 p-4 sm:p-6">
        <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <figure>
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
              <video
                ref={source}
                src={`${SRC}.mp4`}
                poster={`${SRC}.jpg`}
                muted
                playsInline
                loop
                preload="none"
                className="h-full w-full object-cover"
              />
              <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[11px] font-semibold text-white backdrop-blur">
                16:9 original
              </span>
              <PlayToggle playing={playing} onToggle={toggle} />
            </div>
            <figcaption className="fc-meta mt-2">
              Footage:{' '}
              <a
                href="https://www.pexels.com/video/podcast-interview-6878733/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-zinc-300"
              >
                cottonbro studio via Pexels
              </a>
              . Outputs are unedited Flipcast renders.
            </figcaption>
          </figure>

          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <Phone base={CENTRE} label="Centre crop" good={false} videoRef={centre} />
            <Phone base={TRACKED} label="Flipcast Auto-track" good videoRef={output} />
          </div>
        </div>

        <div className="mt-6 flex flex-col items-center justify-between gap-3 border-t border-white/[0.06] pt-5 sm:flex-row">
          <p className="fc-body text-center sm:text-left">
            Run it yourself: load this clip into the studio and render it in your own browser.
          </p>
          <button onClick={onSample} className="fc-btn-primary shrink-0">
            <Upload className="h-4 w-4" />
            Try this clip in Flipcast
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * The hero's proof: a two-person podcast wide shot, where a centre crop is
 * an empty table and Flipcast stacks both speakers.
 */
export function HeroShowcase() {
  const root = useRef<HTMLDivElement>(null);
  const { source, centre, output, playing, toggle } = useComparePlayback(root);
  return (
    <div ref={root} className="relative mx-auto w-full max-w-[30rem]">
      <div className="absolute inset-0 -z-10 scale-110 rounded-full bg-pink-500/15 blur-3xl" aria-hidden="true" />
      <figure>
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black shadow-2xl shadow-black/60 ring-1 ring-white/15">
          <video
            ref={source}
            src={`${TWO_SRC}.mp4`}
            poster={`${TWO_SRC}.jpg`}
            muted
            playsInline
            loop
            preload="none"
            aria-label="Original 16:9 podcast clip with two hosts"
            className="h-full w-full object-cover"
          />
          <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[11px] font-semibold text-white backdrop-blur">
            16:9 original
          </span>
          {/* Top corner: the phones overlap the bottom of this frame. */}
          <PlayToggle playing={playing} onToggle={toggle} className="right-2 top-2" />
        </div>
      </figure>
      <div className="relative -mt-6 grid grid-cols-2 gap-4 px-6 sm:-mt-10 sm:px-10">
        <Phone base={TWO_CENTRE} label="Centre crop" good={false} videoRef={centre} />
        <Phone base={TWO_SPLIT} label="Flipcast" good videoRef={output} />
      </div>
      <p className="fc-meta mt-3 text-center">
        Unedited Flipcast output · footage{' '}
        <a href={TWO_CREDIT} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-zinc-300">
          cottonbro studio / Pexels
        </a>
      </p>
    </div>
  );
}
