/**
 * Split-screen layout for two people on camera together.
 *
 * In a two-person podcast or interview shot, the speakers usually sit too far
 * apart for one 9:16 window to hold both, so a single tracked crop has to
 * pick one and drop the other. Split screen stacks a crop of each person in
 * one vertical frame instead: left speaker on top, right speaker below.
 *
 * The decision is made once per clip from the detector samples. Speakers in
 * this kind of shot are seated and the camera is locked off, so each panel is
 * a fixed crop around that person's median position. Clips where people walk
 * around, or are only sometimes on camera together, keep the tracked crop.
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

/** Share of all samples that must show both people for split screen to pay off. */
const MIN_TOGETHER = 0.6;
/** The smaller face must be at least this fraction of the larger one's width. */
const MIN_SIZE_RATIO = 0.45;
/** Faces smaller than this (frame width fraction) are background, not speakers. */
const MIN_FACE = 0.025;
/** Beyond this spread (frame fraction) a person is moving too much for a fixed panel. */
const MAX_WANDER = 0.08;

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

/**
 * Decide whether `ratio` should be rendered as a split screen, and where each
 * person is. Returns null to keep the normal (tracked) crop.
 */
export function planSplit(
  samples: SubjectSample[],
  srcW: number,
  srcH: number,
  ratio: Ratio = '9:16',
): SplitLayout | null {
  if (ratio !== '9:16' || samples.length === 0 || !(srcW > srcH)) return null;
  const windowW = cropFor(srcW, srcH, ratio).cw / srcW;

  const left: SplitPanel[] = [];
  const right: SplitPanel[] = [];
  for (const s of samples) {
    const faces = (s.faces ?? []).filter((f) => f.w >= MIN_FACE).sort((a, b) => b.w - a.w);
    if (faces.length < 2) continue;
    const [a, b] = faces;
    if (b.w < a.w * MIN_SIZE_RATIO) continue;
    const [l, r] = a.cx <= b.cx ? [a, b] : [b, a];
    // Only worth splitting when one 9:16 window cannot hold both faces.
    const span = r.cx + r.w / 2 - (l.cx - l.w / 2);
    if (span <= windowW) continue;
    left.push(l);
    right.push(r);
  }

  if (left.length < samples.length * MIN_TOGETHER) return null;
  for (const side of [left, right]) {
    if (spread(side.map((p) => p.cx)) > MAX_WANDER || spread(side.map((p) => p.cy)) > MAX_WANDER) return null;
  }

  const panel = (side: SplitPanel[]): SplitPanel => ({
    cx: median(side.map((p) => p.cx)),
    cy: median(side.map((p) => p.cy)),
    w: median(side.map((p) => p.w)),
  });
  return { top: panel(left), bottom: panel(right) };
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

/**
 * Filtergraph segment that reads `input` and writes `output` as a split
 * screen. `overlay` (burned-in captions) is drawn on the stacked frame, so
 * captions sit across the seam the way split-screen Shorts usually have them.
 */
export function splitFilter(
  layout: SplitLayout,
  srcW: number,
  srcH: number,
  canvas: { w: number; h: number },
  input: string,
  output: string,
  tag: string,
  overlay?: string | null,
): string {
  const half = even(canvas.h / 2);
  const part = (p: SplitPanel) => {
    const c = panelCrop(p, srcW, srcH, canvas);
    return `crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${canvas.w}:${half},setsar=1`;
  };
  return [
    `${input}split=2[${tag}a][${tag}b]`,
    `[${tag}a]${part(layout.top)}[${tag}t]`,
    `[${tag}b]${part(layout.bottom)}[${tag}u]`,
    `[${tag}t][${tag}u]vstack=inputs=2,${overlay ? `${overlay},` : ''}format=yuv420p${output}`,
  ].join(';');
}
