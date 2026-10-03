/**
 * Subject tracking: from per-frame detections to a crop that follows the subject.
 *
 * Pure (no browser or Node APIs), so the render engine and the verification
 * scripts share it. The detector (subject-detect.ts) produces a sparse list of
 * samples; this module turns them into a smooth camera path and then into an
 * FFmpeg expression the crop filter evaluates per frame.
 *
 * Why an expression rather than many crops: the crop filter re-evaluates its
 * x/y expressions for every frame with `t` bound to the frame time, so one
 * filter can pan smoothly through the whole clip in the same single pass that
 * already renders every format.
 */

import { cropFor, type Ratio } from './geometry';

/** A detected face: centre and width, in frame fractions. */
export type FaceBox = { cx: number; cy: number; w: number };

/**
 * One detector sample: subject centre in frame fractions, or null if none seen.
 * `faces` lists every face in the frame, for the split-screen layout (layout.ts).
 */
export type SubjectSample = ({ t: number; x: number; y: number } | { t: number; x: null; y: null }) & {
  faces?: FaceBox[];
};

/** Subject centre over time, in frame fractions (0..1), with ascending times. */
export type SubjectPath = { t: number[]; x: number[]; y: number[] };

/** A track ready for the crop filter: offset fractions as FFmpeg expressions. */
export type FocusTrack = { xExpr: string; yExpr: string };

/**
 * Most points a single expression carries. Each adds one `clip()` term; 80 keeps
 * the filtergraph short and evaluation cheap, and is more than enough for a
 * smoothed path once simplified.
 */
export const MAX_TRACK_POINTS = 80;

/**
 * Turn raw samples into a smooth path, or null when the subject was never found.
 *
 * 1. Gaps (no detection) are bridged by interpolating between the detections
 *    either side, so a blink or a turn of the head neither snaps back to centre
 *    nor freezes the frame while the subject keeps moving. Before the first and
 *    after the last detection the nearest value is held.
 *    Before that, a detection is dropped as a false positive when its two
 *    neighbours agree with each other and it lands far from both. A median
 *    filter would also remove it, but on a moving subject it shifts the whole
 *    path by a sample, which a narrow 9:16 crop magnifies into a visible lag.
 * 2. A zero-phase exponential smoother (forward then backward) gives the slow,
 *    deliberate motion of a camera operator rather than detector jitter, with
 *    no lag, because the backward pass cancels the forward pass's delay. The
 *    series is padded with an odd reflection at both ends first, so steady
 *    motion passes through unchanged instead of flattening at the clip edges.
 */
export function smoothPath(samples: SubjectSample[], timeConstant = 0.35): SubjectPath | null {
  const found = samples.filter((s) => s.x !== null).length;
  if (samples.length === 0 || found === 0) return null;

  const t = samples.map((s) => s.t);
  const clean = rejectOutliers(samples);
  const fill = (key: 'x' | 'y'): number[] => {
    const raw = clean.map((s) => s[key]);
    const known = raw.flatMap((v, i) => (v === null ? [] : [i]));
    return raw.map((v, i) => {
      if (v !== null) return v;
      const next = known.find((k) => k > i);
      const prev = [...known].reverse().find((k) => k < i);
      if (prev === undefined) return raw[next!]!;
      if (next === undefined) return raw[prev]!;
      const f = (t[i] - t[prev]) / (t[next] - t[prev] || 1);
      return raw[prev]! + f * (raw[next]! - raw[prev]!);
    });
  };

  const zeroPhase = (v: number[]): number[] => {
    const n = v.length;
    if (n < 3) return v.slice();
    // Odd reflection: 2*v0 - v[k] before the start, 2*v[n-1] - v[n-1-k] after.
    const pad = Math.min(n - 1, 12);
    const pv: number[] = [];
    const pt: number[] = [];
    for (let k = pad; k >= 1; k--) {
      pv.push(2 * v[0] - v[k]);
      pt.push(2 * t[0] - t[k]);
    }
    pv.push(...v);
    pt.push(...t);
    for (let k = 1; k <= pad; k++) {
      pv.push(2 * v[n - 1] - v[n - 1 - k]);
      pt.push(2 * t[n - 1] - t[n - 1 - k]);
    }
    const pass = (arr: number[], times: number[]): number[] => {
      const out = arr.slice();
      for (let i = 1; i < arr.length; i++) {
        const dt = Math.max(1e-3, Math.abs(times[i] - times[i - 1]));
        const a = 1 - Math.exp(-dt / timeConstant);
        out[i] = out[i - 1] + a * (arr[i] - out[i - 1]);
      }
      return out;
    };
    const fwd = pass(pv, pt);
    const both = pass(fwd.slice().reverse(), pt.slice().reverse()).reverse();
    return both.slice(pad, pad + n);
  };

  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  return {
    t,
    x: zeroPhase(fill('x')).map(clamp01),
    y: zeroPhase(fill('y')).map(clamp01),
  };
}

/** How far (frame fraction) a lone detection may sit from agreeing neighbours. */
const OUTLIER_DISTANCE = 0.15;

/** Drop isolated detections that disagree with both agreeing neighbours. */
function rejectOutliers(samples: SubjectSample[]): SubjectSample[] {
  const dist = (a: SubjectSample, b: SubjectSample) =>
    Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0));
  return samples.map((s, i) => {
    if (s.x === null) return s;
    const prev = samples.slice(0, i).reverse().find((p) => p.x !== null);
    const next = samples.slice(i + 1).find((n) => n.x !== null);
    if (!prev || !next || dist(prev, next) > OUTLIER_DISTANCE) return s;
    // Where the subject would be if it moved steadily between the neighbours.
    const f = (s.t - prev.t) / (next.t - prev.t || 1);
    const expected = {
      t: s.t,
      x: prev.x! + f * (next.x! - prev.x!),
      y: prev.y! + f * (next.y! - prev.y!),
    };
    return dist(s, expected) > OUTLIER_DISTANCE ? { t: s.t, x: null, y: null } : s;
  });
}

/** Indices kept by Ramer-Douglas-Peucker on (t, v) with tolerance `eps`. */
function rdp(t: number[], v: number[], eps: number): number[] {
  const keep = new Set<number>([0, t.length - 1]);
  const stack: [number, number][] = [[0, t.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let worstD = eps;
    for (let i = a + 1; i < b; i++) {
      const span = t[b] - t[a] || 1;
      const lerp = v[a] + ((v[b] - v[a]) * (t[i] - t[a])) / span;
      const d = Math.abs(v[i] - lerp);
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst !== -1) {
      keep.add(worst);
      stack.push([a, worst], [worst, b]);
    }
  }
  return [...keep].sort((x, y) => x - y);
}

/**
 * Keep the fewest points that still trace `values` within `eps`, loosening the
 * tolerance until at most `max` remain.
 */
export function simplify(
  t: number[],
  values: number[],
  max = MAX_TRACK_POINTS,
  eps = 0.004,
): { t: number[]; v: number[] } {
  if (t.length <= 2) return { t: t.slice(), v: values.slice() };
  let tol = eps;
  let idx = rdp(t, values, tol);
  while (idx.length > max) {
    tol *= 1.5;
    idx = rdp(t, values, tol);
  }
  return { t: idx.map((i) => t[i]), v: idx.map((i) => values[i]) };
}

const num = (n: number) => {
  const s = n.toFixed(4);
  // Trim trailing zeros to keep the filtergraph short.
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') || '0' : s;
};

/**
 * Piecewise-linear function of `t` as a flat FFmpeg expression.
 *
 *   v0 + Σ slope_i * clip(t - t_i, 0, dt_i)
 *
 * Each term contributes its segment's rise only once `t` has reached it and
 * stops growing at the segment's end, so the sum traces the polyline exactly
 * and holds the last value after the final point. A flat sum (no nested if())
 * keeps parsing depth constant however many points there are.
 *
 * Commas are escaped (`\,`) because the result sits inside a filtergraph.
 */
export function linearExpr(times: number[], values: number[]): string {
  if (values.length === 0) return '0.5';
  let expr = num(values[0]);
  for (let i = 1; i < times.length; i++) {
    const dt = times[i] - times[i - 1];
    const dv = values[i] - values[i - 1];
    if (dt <= 0 || Math.abs(dv) < 1e-5) continue;
    const slope = dv / dt;
    const term = `${num(Math.abs(slope))}*clip(t-${num(times[i - 1])}\\,0\\,${num(dt)})`;
    expr += slope < 0 ? `-${term}` : `+${term}`;
  }
  return `clip(${expr}\\,0\\,1)`;
}

/**
 * Convert a subject centre (frame fraction) to the crop offset fraction that
 * centres the subject in `ratio`'s crop window.
 *
 * The crop filter places the window at `(iw - cw) * f`, so a subject at `c`
 * is centred when `f = (c*W - cw/2) / (W - cw)`. With no slack on an axis (the
 * crop spans the whole frame) the offset is irrelevant and stays 0.5.
 */
export function offsetFraction(center: number, frame: number, crop: number): number {
  const slack = frame - crop;
  if (slack <= 0) return 0.5;
  return Math.min(1, Math.max(0, (center * frame - crop / 2) / slack));
}

/** The crop-filter track for one output ratio, from a smoothed subject path. */
export function focusTrackFor(
  path: SubjectPath,
  ratio: Ratio,
  srcW: number,
  srcH: number,
): FocusTrack {
  const { cw, ch } = cropFor(srcW, srcH, ratio);
  const fx = path.x.map((c) => offsetFraction(c, srcW, cw));
  const fy = path.y.map((c) => offsetFraction(c, srcH, ch));
  const sx = simplify(path.t, fx);
  const sy = simplify(path.t, fy);
  return { xExpr: linearExpr(sx.t, sx.v), yExpr: linearExpr(sy.t, sy.v) };
}

/** How often to sample for a clip of `duration` seconds: dense, but bounded. */
export function sampleTimes(duration: number, maxSamples = 360, minStep = 1 / 3): number[] {
  if (!(duration > 0)) return [];
  const step = Math.max(minStep, duration / maxSamples);
  const out: number[] = [];
  // Start a little in so the first sample is a real frame, not a black lead-in.
  for (let t = Math.min(0.05, duration / 2); t < duration; t += step) out.push(t);
  return out;
}
