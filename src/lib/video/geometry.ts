/**
 * Shared video framing geometry.
 *
 * Used by the in-browser render engine and (later) the server-side FFmpeg
 * worker, so both produce byte-identical framing. Keep this module free of
 * Node and browser APIs — it must stay pure.
 */

export type Ratio = '9:16' | '1:1' | '16:9';

export const RATIOS: readonly Ratio[] = ['9:16', '1:1', '16:9'] as const;

/** Long-edge-first output canvas for each ratio. */
export const OUTPUT_CANVAS: Record<Ratio, { w: number; h: number }> = {
  '9:16': { w: 1080, h: 1920 },
  '1:1': { w: 1080, h: 1080 },
  '16:9': { w: 1920, h: 1080 },
};

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
 */
export function filterExpr(ratio: Ratio): string {
  const { w, h } = OUTPUT_CANVAS[ratio];
  const t = aspect(ratio);
  // Comma inside min() must be escaped inside a filtergraph description.
  const cropW = `floor(min(iw\\,ih*${t})/2)*2`;
  const cropH = `floor(min(ih\\,iw/${t})/2)*2`;
  return [
    `crop=${cropW}:${cropH}`,
    `scale=${w}:${h}`,
    // Keep square pixels: the crop rectangle is not exactly the target shape
    // after even-rounding, so compensate instead of letting players stretch.
    'setsar=1',
    'format=yuv420p',
  ].join(',');
}