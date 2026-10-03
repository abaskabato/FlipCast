/**
 * Split-screen layout for two people on camera together.
 *
 * In a two-person podcast or interview shot, the speakers usually sit too far
 * apart for one 9:16 window to hold both, so a single tracked crop has to
 * pick one and drop the other. Split screen stacks a crop of each person in
 * one vertical frame instead: left speaker on top, right speaker below.
 *
 * Layouts switch mid-clip: split screen runs only for the stretches where both
 * people are on camera together, and the tracked single crop covers the rest
 * (a cutaway to one speaker, a wide shot that loses someone). Within each
 * stretch the camera is assumed locked off, so each panel is a fixed crop
 * around that person's median position there; a stretch where people move
 * around too much keeps the tracked crop.
 *
 * Pure (no browser or Node APIs), shared by the render engine and
 * scripts/verify-layout.mjs.
 */

import { cropFor, even, type Ratio } from './geometry';
import type { SubjectSample } from './tracking';

/** One person: face centre and face width, in source-frame fractions. */
export type SplitPanel = { cx: number; cy: number; w: number };

/** Top and bottom panels of a split-screen output. */
export type SplitLayout = { top: SplitPanel; bottom: SplitPanel };

/**
 * A stretch of the clip shown as split screen, in seconds. `end` is Infinity
 * when it runs to the end of the clip.
 */
export type SplitSegment = { start: number; end: number; layout: SplitLayout };

/** The smaller face must be at least this fraction of the larger one's width. */
const MIN_SIZE_RATIO = 0.45;
/** Faces smaller than this (frame width fraction) are background, not speakers. */
const MIN_FACE = 0.025;
/** Beyond this spread (frame fraction) a person is moving too much for a fixed panel. */
const MAX_WANDER = 0.08;
/** Shorter stretches together are not worth a layout change (seconds). */
const MIN_SEGMENT = 2;
/** Shorter gaps between two split stretches are bridged, not cut to single (seconds). */
const MIN_GAP = 1.2;
/** Samples either side that vote on whether a sample counts as "together". */
const VOTE_RADIUS = 2;

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Typical distance from the median, robust to the odd stray detection. */
const spread = (v: number[]) => {
  const m = median(v);
  return median(v.map((x) => Math.abs(x - m)));
};

/** The two speakers in a sample, left first, or null if it does not need a split. */
function pairIn(s: SubjectSample, windowW: number): [SplitPanel, SplitPanel] | null {
  const faces = (s.faces ?? []).filter((f) => f.w >= MIN_FACE).sort((a, b) => b.w - a.w);
  if (faces.length < 2) return null;
  const [a, b] = faces;
  if (b.w < a.w * MIN_SIZE_RATIO) return null;
  const [l, r] = a.cx <= b.cx ? [a, b] : [b, a];
  // Only worth splitting when one 9:16 window cannot hold both faces.
  const span = r.cx + r.w / 2 - (l.cx - l.w / 2);
  return span > windowW ? [l, r] : null;
}

const panelOf = (side: SplitPanel[]): SplitPanel => ({
  cx: median(side.map((p) => p.cx)),
  cy: median(side.map((p) => p.cy)),
  w: median(side.map((p) => p.w)),
});

/**
 * The stretches of the clip to show as split screen, in time order. Empty
 * means "keep the normal (tracked) crop throughout". Only 9:16 is split.
 */
export function planSplitSegments(
  samples: SubjectSample[],
  srcW: number,
  srcH: number,
  ratio: Ratio = '9:16',
): SplitSegment[] {
  if (ratio !== '9:16' || samples.length === 0 || !(srcW > srcH)) return [];
  const windowW = cropFor(srcW, srcH, ratio).cw / srcW;
  const pairs = samples.map((s) => pairIn(s, windowW));

  // Majority vote over neighbours, so a missed detection or a stray face in a
  // single sample neither ends a split stretch nor starts one.
  const together = pairs.map((_, i) => {
    let yes = 0;
    let n = 0;
    for (let k = Math.max(0, i - VOTE_RADIUS); k <= Math.min(pairs.length - 1, i + VOTE_RADIUS); k++) {
      n++;
      if (pairs[k]) yes++;
    }
    return yes * 2 > n;
  });

  // Runs of "together", as sample index ranges [a, b].
  let runs: [number, number][] = [];
  for (let i = 0; i < together.length; i++) {
    if (!together[i]) continue;
    const a = i;
    while (i + 1 < together.length && together[i + 1]) i++;
    runs.push([a, i]);
  }
  const t = (i: number) => samples[i].t;
  // Bridge short gaps, then drop stretches too short to be worth a cut.
  runs = runs.reduce<[number, number][]>((acc, r) => {
    const prev = acc[acc.length - 1];
    if (prev && t(r[0]) - t(prev[1]) < MIN_GAP) prev[1] = r[1];
    else acc.push([...r]);
    return acc;
  }, []);

  const last = samples.length - 1;
  const segments: SplitSegment[] = [];
  for (const [a, b] of runs) {
    // Cut halfway between samples; the first and last stretches reach the ends.
    const start = a === 0 ? 0 : (t(a - 1) + t(a)) / 2;
    const end = b === last ? Infinity : (t(b) + t(b + 1)) / 2;
    if ((b === last ? t(b) - start : end - start) < MIN_SEGMENT) continue;
    const found = pairs.slice(a, b + 1).filter((p): p is [SplitPanel, SplitPanel] => p !== null);
    const left = found.map((p) => p[0]);
    const right = found.map((p) => p[1]);
    if (
      [left, right].some(
        (side) => spread(side.map((p) => p.cx)) > MAX_WANDER || spread(side.map((p) => p.cy)) > MAX_WANDER,
      )
    ) {
      continue;
    }
    segments.push({ start, end, layout: { top: panelOf(left), bottom: panelOf(right) } });
  }
  return segments;
}

/** True when one split stretch covers the whole clip (no layout changes). */
export function isWholeClip(segments: SplitSegment[]): boolean {
  return segments.length === 1 && segments[0].start === 0 && segments[0].end === Infinity;
}

/** A source-pixel crop rectangle. */
export type PixelCrop = { w: number; h: number; x: number; y: number };

/**
 * The source rectangle for one panel of a `canvas`-sized split output.
 *
 * Each panel is half the canvas height, so a 9:16 canvas has 9:8 panels. The
 * crop is about four face-widths wide (head and shoulders, the framing these
 * layouts use everywhere), with the eyes about 38% down the panel.
 */
export function panelCrop(
  panel: SplitPanel,
  srcW: number,
  srcH: number,
  canvas: { w: number; h: number },
): PixelCrop {
  const aspect = canvas.w / (canvas.h / 2);
  let w = Math.min(Math.max(panel.w * srcW * 4.2, srcW * 0.22), srcW, srcH * aspect);
  let h = w / aspect;
  if (h > srcH) {
    h = srcH;
    w = h * aspect;
  }
  const ew = Math.min(even(w), srcW - (srcW % 2));
  const eh = Math.min(even(h), srcH - (srcH % 2));
  const clamp = (v: number, max: number) => Math.round(Math.min(Math.max(0, v), Math.max(0, max)));
  return {
    w: ew,
    h: eh,
    x: clamp(panel.cx * srcW - ew / 2, srcW - ew),
    y: clamp(panel.cy * srcH - eh * 0.38, srcH - eh),
  };
}

/** crop + scale for one panel, to half the canvas height. */
function panelChain(p: SplitPanel, srcW: number, srcH: number, canvas: { w: number; h: number }): string {
  const c = panelCrop(p, srcW, srcH, canvas);
  return `crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${canvas.w}:${even(canvas.h / 2)},setsar=1`;
}

/** Two stacked panels from `input` into `output`. */
function stack(layout: SplitLayout, srcW: number, srcH: number, canvas: { w: number; h: number }, input: string, output: string, tag: string): string[] {
  return [
    `${input}split=2[${tag}a][${tag}b]`,
    `[${tag}a]${panelChain(layout.top, srcW, srcH, canvas)}[${tag}t]`,
    `[${tag}b]${panelChain(layout.bottom, srcW, srcH, canvas)}[${tag}u]`,
    `[${tag}t][${tag}u]vstack=inputs=2${output}`,
  ];
}

const sec = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * Filtergraph segment that reads `input` and writes `output`: the `base`
 * chain (the normal tracked crop, ending at the canvas size, without format)
 * with split screen laid over it for each segment. A split covering the whole
 * clip skips the base entirely. `overlay` (burned-in captions) is drawn last,
 * so captions sit across the seam the way split-screen Shorts have them, and
 * stay put when the layout changes.
 */
export function splitFilter(
  segments: SplitSegment[],
  srcW: number,
  srcH: number,
  canvas: { w: number; h: number },
  base: string,
  input: string,
  output: string,
  tag: string,
  overlay?: string | null,
): string {
  const tail = `${overlay ? `${overlay},` : ''}format=yuv420p${output}`;
  if (isWholeClip(segments)) {
    const parts = stack(segments[0].layout, srcW, srcH, canvas, input, `[${tag}s]`, tag);
    return [...parts, `[${tag}s]${tail}`].join(';');
  }
  const n = segments.length;
  const copies = Array.from({ length: n + 1 }, (_, i) => `[${tag}c${i}]`).join('');
  const parts = [`${input}split=${n + 1}${copies}`, `[${tag}c0]${base}[${tag}o0]`];
  segments.forEach((seg, i) => {
    parts.push(...stack(seg.layout, srcW, srcH, canvas, `[${tag}c${i + 1}]`, `[${tag}s${i}]`, `${tag}${i}`));
    // Quoted, so the commas need no escaping (ffmpeg's documented form).
    const until = Number.isFinite(seg.end) ? `between(t,${sec(seg.start)},${sec(seg.end)})` : `gte(t,${sec(seg.start)})`;
    parts.push(`[${tag}o${i}][${tag}s${i}]overlay=0:0:enable='${until}'[${tag}o${i + 1}]`);
  });
  parts.push(`[${tag}o${n}]${tail}`);
  return parts.join(';');
}
