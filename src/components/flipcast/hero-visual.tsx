/**
 * The landing illustration: one wide master, the vertical window Auto-track
 * keeps on the speaker, and the captioned cuts that come out. Pure CSS, so it
 * costs nothing to load and satisfies the site's COEP header.
 */

/** A stylised studio scene. `subjectX` is the speaker's centre, 0..1 across. */
function Scene({ subjectX = 0.5, scale = 1 }: { subjectX?: number; scale?: number }) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-gradient-to-br from-indigo-950 via-fuchsia-950 to-orange-950">
      {/* A lit backdrop and a window, so the crop reads as a crop of a place. */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgb(251_146_60/0.35),transparent_45%)]" />
      <div className="absolute left-[8%] top-[14%] h-[44%] w-[22%] rounded-sm border border-white/10 bg-sky-300/10" />
      <div className="absolute bottom-0 left-0 right-0 h-[22%] bg-black/30" />
      {/* The speaker. */}
      <div
        className="absolute bottom-0 flex flex-col items-center"
        style={{ left: `${subjectX * 100}%`, transform: `translateX(-50%) scale(${scale})`, transformOrigin: 'bottom center' }}
      >
        <div className="h-7 w-7 rounded-full bg-gradient-to-b from-amber-200 to-amber-300 shadow-[0_0_0_3px_rgb(0_0_0/0.15)]" />
        <div className="-mt-0.5 h-12 w-16 rounded-t-[2rem] bg-gradient-to-b from-pink-500 to-fuchsia-700" />
      </div>
    </div>
  );
}

/** Captions drawn like the "Bold" burn-in style. */
function Caption({ words, hot, className = '' }: { words: string[]; hot: number; className?: string }) {
  return (
    <p
      className={`font-display absolute inset-x-0 text-center font-extrabold uppercase leading-none tracking-tight ${className}`}
      style={{ textShadow: '0 0 3px #000, 0 0 3px #000, 1px 1px 0 #000' }}
    >
      {words.map((w, i) => (
        <span key={i} className={i === hot ? 'text-yellow-300' : 'text-white'}>
          {w}
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </p>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="absolute left-2 top-2 z-10 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[10px] font-semibold text-white backdrop-blur">
      {children}
    </span>
  );
}

export default function HeroVisual() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-[460px] select-none">
      <div className="absolute inset-0 -z-10 scale-110 rounded-full bg-pink-500/15 blur-3xl" />

      {/* Source: 16:9 with the 9:16 window locked on the speaker. */}
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/15 shadow-2xl shadow-black/60">
        <Scene subjectX={0.66} />
        <Tag>16:9 master</Tag>
        <div
          className="absolute inset-y-0 rounded-md border-2 border-pink-400"
          style={{ left: '50.2%', width: '31.6%', boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.5)' }}
        >
          <span className="absolute -top-px left-1/2 -translate-x-1/2 whitespace-nowrap rounded-b-md bg-pink-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
            Auto-track
          </span>
        </div>
      </div>

      {/* Outputs. */}
      <div className="relative -mt-10 flex items-end justify-center gap-4 pl-6 sm:-mt-14">
        <div className="relative aspect-[9/16] w-[38%] overflow-hidden rounded-[18px] border-[3px] border-zinc-800 bg-black shadow-2xl shadow-black/70 ring-1 ring-white/15">
          <Scene subjectX={0.5} scale={1.9} />
          <Tag>9:16</Tag>
          <Caption words={['one', 'clip', 'every', 'feed']} hot={2} className="bottom-[22%] px-2 text-[15px]" />
        </div>
        <div className="relative mb-6 aspect-square w-[30%] overflow-hidden rounded-[14px] border-[3px] border-zinc-800 bg-black shadow-2xl shadow-black/70 ring-1 ring-white/15">
          <Scene subjectX={0.5} scale={1.3} />
          <Tag>1:1</Tag>
          <Caption words={['every', 'feed']} hot={1} className="bottom-[16%] text-[12px]" />
        </div>
      </div>
    </div>
  );
}
