'use client';

import { useEffect, useRef, useState } from 'react';
import { Pause, Play, ScanFace, Upload, XCircle } from 'lucide-react';

/**
 * Real footage, real output. The two vertical clips are unedited Flipcast
 * renders of the source (see public/demo/CREDITS.txt): one with a plain centre
 * crop, one with Auto-track. They play in lockstep so the difference is
 * impossible to miss.
 */

const SRC = '/demo/podcast-source';
const CENTRE = '/demo/podcast-centre';
const TRACKED = '/demo/podcast-tracked';

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

export default function RealDemo({ onSample }: { onSample: () => void }) {
  const source = useRef<HTMLVideoElement>(null);
  const centre = useRef<HTMLVideoElement>(null);
  const tracked = useRef<HTMLVideoElement>(null);
  const root = useRef<HTMLElement>(null);
  const [playing, setPlaying] = useState(false);
  // Set once the visitor pauses, so scrolling back does not override them.
  const userPaused = useRef(false);

  const all = () => [source.current, centre.current, tracked.current].filter(Boolean) as HTMLVideoElement[];

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
      for (const v of [centre.current, tracked.current]) {
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

  return (
    <section ref={root} aria-labelledby="real-demo" className="pt-16">
      <div className="text-center">
        <p className="fc-chip-accent mx-auto w-fit">Real footage · real output</p>
        <h2 id="real-demo" className="fc-display mt-4 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Same clip. <span className="fc-gradient-text">Two very different Shorts.</span>
        </h2>
        <p className="fc-body mx-auto mt-2 max-w-xl">
          A two-person podcast, cut to vertical. A plain centre crop slices both speakers in half.
          Auto-track finds each face and frames it, even across the camera move.
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
              <button
                onClick={() => {
                  userPaused.current = playing;
                  if (playing) pause();
                  else play();
                }}
                aria-label={playing ? 'Pause comparison' : 'Play comparison'}
                className="absolute bottom-3 left-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition-colors hover:bg-black/80"
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
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
            <Phone base={TRACKED} label="Flipcast Auto-track" good videoRef={tracked} />
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
