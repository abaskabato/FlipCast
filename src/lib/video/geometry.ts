/**
 * Shared video framing geometry.
 *
 * Used by the in-browser render engine and (later) the server-side FFmpeg
 * worker, so both produce byte-identical framing. Keep this module free of
 * Node and browser APIs — it must stay pure.
 */

import type { FocusTrack } from './tracking';

export type Ratio = '9:16' | '1:1' | '16:9';

export const RATIOS: readonly Ratio[] = ['9:16', '1:1', '16:9'] as const;

/** Long-edge-first output canvas for each ratio. */
export const OUTPUT_CANVAS: Record<Ratio, { w: number; h: number }> = {
  '9:16': { w: 1080, h: 1920 },
  '1:1': { w: 1080, h: 1080 },
  '16:9': { w: 1920, h: 1080 },
};

/**
 * Smaller canvas for crops that do not have 1080-class detail to begin with.
 *
 * A 9:16 crop of a 1080p landscape clip is only 608 px wide. Scaling it up to
 * 1080x1920 adds no detail but makes the encoder process 2.25x the pixels -
 * the single largest cost of a browser render. Platforms accept 720x1280 and
 * upscale on playback, so the picture is the same and the render is faster.
 */
export const OUTPUT_CANVAS_720: Record<Ratio, { w: number; h: number }> = {
  '9:16': { w: 720, h: 1280 },
  '1:1': { w: 720, h: 720 },
  '16:9': { w: 1280, h: 720 },
};

/** Crop short side, in source pixels, from which 1080-class output pays off. */
const HD_SHORT_SIDE = 1000;

/**
 * The canvas to render `ratio` at for a source of the given displayed size:
 * 1080-class when the crop really has that much detail, 720-class otherwise.
 * Unknown dimensions fall back to 1080-class, the previous behaviour.
 */
export function outputCanvas(
  ratio: Ratio,
  srcW?: number | null,
  srcH?: number | null,
): { w: number; h: number } {
  if (!srcW || !srcH) return OUTPUT_CANVAS[ratio];
  const { cw, ch } = cropFor(srcW, srcH, ratio);
  return Math.min(cw, ch) >= HD_SHORT_SIDE ? OUTPUT_CANVAS[ratio] : OUTPUT_CANVAS_720[ratio];
}

function aspect(r: Ratio): number {
  const { w, h } = OUTPUT_CANVAS[r];
  return w / h;
}

/**
 * yuv420p requires even width/height, and many phones reject odd dimensions.
 * Round to the nearest even value, and never return 0.
 */
export function even(n: number): number {
  const v = Math.round(n);
  if (v < 2) return 2;
  return v % 2 === 0 ? v : v + 1;
}

/** Clamp to the source so we never crop outside the frame. */
function clampToSource(n: number, max: number): number {
  return Math.min(even(n), even(max));
}

export type Crop = {
  /** Crop rectangle width in source pixels. */
  cw: number;
  /** Crop rectangle height in source pixels. */
  ch: number;
  /** Offset x from the left edge (centre crop => 0 after we compute cw). */
  ox: number;
  /** Offset y from the top edge. */
  oy: number;
};

/**
 * Compute a centred crop rectangle that fills the target ratio without
 * distortion. When the source is already the target shape we return the full
 * frame (still rounded to even dimensions).
 */
export function cropFor(srcW: number, srcH: number, ratio: Ratio): Crop {
  const t = aspect(ratio);
  const s = srcW / srcH;

  let cw: number;
  let ch: number;

  if (Math.abs(s - t) < 1e-6) {
    cw = even(srcW);
    ch = even(srcH);
  } else if (s > t) {
    // Source is wider than target -> trim the sides.
    ch = clampToSource(srcH, srcH);
    cw = clampToSource(ch * t, srcW);
  } else {
    // Source is taller than target -> trim top/bottom.
    cw = clampToSource(srcW, srcW);
    ch = clampToSource(cw / t, srcH);
  }

  // Guarantee exact parity so scale never has to resample a half pixel.
  cw = Math.max(2, cw);
  ch = Math.max(2, ch);
  cw = Math.min(cw, even(srcW));
  ch = Math.min(ch, even(srcH));

  return {
    cw,
    ch,
    ox: Math.max(0, Math.floor((srcW - cw) / 2)),
    oy: Math.max(0, Math.floor((srcH - ch) / 2)),
  };
}

/**
 * Build the FFmpeg `-vf` value for one output, given known source dimensions.
 *
 * Prefer {@link filterExpr} in the browser: it needs no probe and cannot drift
 * from the real frame. This numeric form exists for the server-side worker,
 * where ffprobe already reported the dimensions.
 */
export function filterFor(srcW: number, srcH: number, ratio: Ratio): string {
  const { cw, ch, ox, oy } = cropFor(srcW, srcH, ratio);
  const { w, h } = OUTPUT_CANVAS[ratio];
  const parts: string[] = [];
  if (cw !== srcW || ch !== srcH) {
    parts.push(`crop=${cw}:${ch}:${ox}:${oy}`);
  }
  parts.push(`scale=${w}:${h}`);
  parts.push('setsar=1');
  parts.push('format=yuv420p');
  return parts.join(',');
}

/**
 * Where the subject sits, as fractions of the source frame (0..1).
 *
 * Defaults to the centre. Used by manual crop so a user can keep a face or
 * product in frame instead of losing it to a centre crop.
 */
export type Focus = { x: number; y: number };

export const CENTER_FOCUS: Focus = { x: 0.5, y: 0.5 };

/** Clamp a caller-supplied focus into the unit square. */
export function normalizeFocus(focus?: Partial<Focus> | null): Focus {
  const x = typeof focus?.x === 'number' && Number.isFinite(focus.x) ? focus.x : CENTER_FOCUS.x;
  const y = typeof focus?.y === 'number' && Number.isFinite(focus.y) ? focus.y : CENTER_FOCUS.y;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

/** True when a focus point differs from centre and needs a non-zero offset. */
export function hasOffset(focus?: Partial<Focus> | null): boolean {
  const f = normalizeFocus(focus);
  return Math.abs(f.x - CENTER_FOCUS.x) > 1e-6 || Math.abs(f.y - CENTER_FOCUS.y) > 1e-6;
}

/**
 * Dimension-free equivalent of {@link filterFor}, expressed with FFmpeg's own
 * crop expressions so it evaluates against the real decoded frame at runtime.
 *
 * Advantages over probing first:
 *  - no ffprobe/log-parsing, so nothing to break across ffmpeg versions;
 *  - correct for any input, including odd/rotated/portrait sources;
 *  - one `exec()` instead of a probe pass plus a render pass.
 *
 * `min(iw, ih*T)` picks the crop width and `min(ih, iw/T)` the crop height,
 * which yields the largest centred rectangle of the target shape that fits.
 * Both are floored to an even number because yuv420p needs even dimensions.
 *
 * `focus` shifts the crop window without changing its size. The offsets are
 * `max(0, (iw - cw) * fx)` and the same for y, which keeps the crop inside the
 * frame at every focus value: at fx=0 the window sits flush left, at fx=1 flush
 * right, and the max() clamps the extremes. Omitting them when the focus is
 * centred keeps the common path byte-identical to the previous behaviour.
 */
export function filterExpr(
  ratio: Ratio,
  focus?: Partial<Focus> | FocusTrack | null,
  canvas: { w: number; h: number } = OUTPUT_CANVAS[ratio],
  overlay?: string | null,
): string {
  const { w, h } = canvas;
  const t = aspect(ratio);
  // Comma inside min() must be escaped inside a filtergraph description.
  const cropW = `floor(min(iw\\,ih*${t})/2)*2`;
  const cropH = `floor(min(ih\\,iw/${t})/2)*2`;

  const offsets = (fx: string, fy: string) => {
    const ox = `max(0\\,floor((iw-${cropW})*${fx}))`;
    const oy = `max(0\\,floor((ih-${cropH})*${fy}))`;
    return `crop=${cropW}:${cropH}:${ox}:${oy}`;
  };

  let crop: string;
  if (isFocusTrack(focus)) {
    // Evaluated per frame: the window follows the subject (see tracking.ts).
    crop = offsets(focus.xExpr, focus.yExpr);
  } else if (hasOffset(focus)) {
    const f = normalizeFocus(focus);
    // 6 decimal places is well below one source pixel at any real
    // resolution, and keeps the expression short.
    crop = offsets(f.x.toFixed(6), f.y.toFixed(6));
  } else {
    crop = `crop=${cropW}:${cropH}`;
  }

  return [
    crop,
    `scale=${w}:${h}`,
    // Keep square pixels: the crop rectangle is not exactly the target shape
    // after even-rounding, so compensate instead of letting players stretch.
    'setsar=1',
    // Burned-in captions draw on the final canvas, so their size and position
    // are in output pixels whatever the source resolution.
    ...(overlay ? [overlay] : []),
    'format=yuv420p',
  ].join(',');
}

function isFocusTrack(f: unknown): f is FocusTrack {
  return typeof f === 'object' && f !== null && typeof (f as FocusTrack).xExpr === 'string';
}