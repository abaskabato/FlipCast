'use client';

import { useEffect, useRef } from 'react';

import { demoMedia } from './real-demo';

/** Real clips: each one an unedited Flipcast render (public/demo/CREDITS.txt). */
const CLIPS = [
  { base: '/demo/showcase/astro-bold', label: 'Auto-track', detail: 'Bold captions' },
  { base: '/demo/twoshot-split', label: 'Split screen', detail: 'Two people, one vertical cut' },
  { base: '/demo/showcase/astro-pop', label: 'Auto-track', detail: 'Pop captions' },
  { base: '/demo/showcase/expert-reveal', label: 'Captions over B-roll', detail: 'Reveal style' },
  { base: '/demo/podcast-tracked', label: 'Follows a camera pan', detail: 'No captions' },
  { base: '/demo/showcase/astro-oneword', label: 'Auto-track', detail: 'One word at a time' },
] as const;

/**
 * Plays while on screen, pauses off screen, and stays on its poster for
 * visitors who prefer reduced motion.
 */
function GalleryClip({ base, label, detail }: (typeof CLIPS)[number]) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void v.play().catch(() => undefined);
        else v.pause();
      },
      { threshold: 0.4 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, []);
  return (
    <figure className="w-[42vw] max-w-[180px] shrink-0 snap-center sm:w-auto sm:max-w-none">
      <div className="relative aspect-[9/16] overflow-hidden rounded-[18px] border-[3px] border-zinc-800 bg-black shadow-xl shadow-black/50 ring-1 ring-white/10">
        <video ref={ref} {...demoMedia(base)} muted playsInline loop preload="none" aria-hidden="true" className="h-full w-full object-cover" />
      </div>
      <figcaption className="mt-2.5 text-center">
        <span className="block text-sm font-semibold text-white">{label}</span>
        <span className="fc-meta block">{detail}</span>
      </figcaption>
    </figure>
  );
}

/** "Made with Flipcast": a row of real output clips, like the big tools show. */
export function ClipGallery() {
  return (
    <section aria-labelledby="gallery" className="mt-24">
      <div className="text-center">
        <p className="fc-chip-accent mx-auto w-fit">Made with Flipcast</p>
        <h2 id="gallery" className="fc-display mt-4 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Real clips, straight out of the app
        </h2>
        <p className="fc-body mx-auto mt-2 max-w-xl">
          Long interviews in, vertical clips out: the moment picked by clip finding, the speaker kept in frame,
          captions burned in. Nothing here was edited afterwards.
        </p>
      </div>
      <div className="-mx-4 mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-6">
        {CLIPS.map((c) => (
          <GalleryClip key={c.base} {...c} />
        ))}
      </div>
      <p className="fc-meta mt-5 text-center">
        Footage: NASA (public domain; NASA does not endorse Flipcast) and cottonbro studio via Pexels.
      </p>
    </section>
  );
}
