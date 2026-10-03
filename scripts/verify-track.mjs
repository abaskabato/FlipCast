/**
 * Verifies subject tracking end to end with a real ffmpeg, using the app's own
 * modules (tracking.ts, geometry.ts):
 *
 *  - a subject moving across a landscape frame stays centred in the 9:16 crop;
 *  - the same clip with a fixed centre crop does not (so the test can fail);
 *  - gaps and a single false detection do not throw the crop off;
 *  - a path with many points simplifies to a bounded expression that parses.
 *
 * Run: npm run verify:track
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

import { filterExpr, outputCanvas } from '../src/lib/video/geometry.ts';
import {
  MAX_TRACK_POINTS,
  focusTrackFor,
  sampleTimes,
  smoothPath,
} from '../src/lib/video/tracking.ts';

const work = mkdtempSync(path.join(tmpdir(), 'flipcast-track-'));
const ff = (args) => execFileSync(ffmpegPath, ['-v', 'error', '-y', ...args]);

const W = 1920, H = 1080, D = 4, BOX = 160;
// Box centre moves linearly from x=240 to x=1680 over the clip.
const cx = (t) => 240 + (1440 * t) / D;

const src = path.join(work, 'moving.mp4');
ff([
  '-f', 'lavfi', '-i', `color=black:s=${W}x${H}:d=${D}:r=30`,
  '-f', 'lavfi', '-i', `color=white:s=${BOX}x${BOX}:d=${D}:r=30`,
  '-filter_complex', `[0][1]overlay=x='${cx(0) - BOX / 2}+${1440 / D}*t':y=${(H - BOX) / 2}`,
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', src,
]);

/** Centroid x (0..1) of bright pixels in the output frame at time `t`. */
function centroidAt(file, t, w, h) {
  const raw = execFileSync(ffmpegPath, [
    '-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
  ], { maxBuffer: 64 * 1024 * 1024 });
  let sum = 0, n = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      if (raw[y * w + x] > 128) { sum += x; n++; }
    }
  }
  return n ? sum / n / w : null;
}

function render(name, filter, canvas) {
  const out = path.join(work, `${name}.mp4`);
  ff(['-i', src, '-vf', filter, '-c:v', 'libx264', '-preset', 'ultrafast', out]);
  return out;
}

// Detector stand-in: the true centre at each sample time, with two misses and
// one wild false detection, which smoothing must absorb.
const times = sampleTimes(D);
const samples = times.map((t, i) => {
  if (i === 3 || i === 4) return { t, x: null, y: null };
  if (i === 7) return { t, x: 0.02, y: 0.9 };
  return { t, x: cx(t) / W, y: 0.5 };
});
const pathSmooth = smoothPath(samples);

let fail = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) fail++;
};

check(smoothPath([{ t: 0, x: null, y: null }]) === null, 'no detections -> no track (falls back to centre)');

const canvas = outputCanvas('9:16', W, H);
const track = focusTrackFor(pathSmooth, '9:16', W, H);
const tracked = render('tracked', filterExpr('9:16', track, canvas), canvas);
const centred = render('centred', filterExpr('9:16', null, canvas), canvas);

for (const t of [0.6, 2.0, 3.4]) {
  const a = centroidAt(tracked, t, canvas.w, canvas.h);
  const b = centroidAt(centred, t, canvas.w, canvas.h);
  check(a !== null && Math.abs(a - 0.5) < 0.12,
    `t=${t}s tracked subject centred (x=${a?.toFixed(3)})`);
  if (t !== 2.0) {
    check(b === null || Math.abs(b - 0.5) > 0.2,
      `t=${t}s centre crop does not follow (x=${b === null ? 'out of frame' : b.toFixed(3)})`);
  }
}

// A long, wiggly path must stay within the point budget and still render.
const long = Array.from({ length: 1200 }, (_, i) => ({
  t: i / 3, x: 0.5 + 0.35 * Math.sin(i / 9), y: 0.5,
}));
const longTrack = focusTrackFor(smoothPath(long), '9:16', W, H);
const terms = (longTrack.xExpr.match(/clip\(t-/g) ?? []).length;
check(terms <= MAX_TRACK_POINTS, `long path simplified to ${terms} segments (max ${MAX_TRACK_POINTS})`);
render('long', filterExpr('9:16', longTrack, canvas), canvas);
check(true, 'long-path expression parses and renders');

rmSync(work, { recursive: true, force: true });
console.log(fail ? `\nTRACKING: ${fail} FAILED` : '\nTRACKING: ALL PASS');
process.exit(fail ? 1 : 0);
