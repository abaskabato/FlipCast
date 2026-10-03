/**
 * Verifies the split-screen layout with the app's own modules and a real ffmpeg:
 *
 *  - two seated people too far apart for one 9:16 window for the whole clip
 *    -> one split stretch covering it, left person on top;
 *  - one person, two people close together, a small background face, or
 *    people walking around -> no split;
 *  - two people for part of the clip -> split only for that stretch, with
 *    single-sample detection blips neither starting nor ending a stretch;
 *  - the real filtergraph from buildArgs renders a whole-clip split next to a
 *    16:9 output, and a clip that switches from the normal crop to split
 *    screen and back at the planned times.
 *
 * Run: npm run verify:layout
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

import { buildArgs, planRender } from '../src/lib/video/ffmpeg-client.ts';
import { isWholeClip, panelCrop, planSplitSegments } from '../src/lib/video/layout.ts';

let failed = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
};

const W = 1920, H = 1080;
const N = 40;
const STEP = 0.3;
const face = (cx, cy = 0.4, w = 0.08) => ({ cx, cy, w });
/** N samples; `facesAt(i)` gives the faces in sample i. */
const samples = (facesAt) =>
  Array.from({ length: N }, (_, i) => {
    const faces = facesAt(i);
    const main = faces[0];
    return main ? { t: i * STEP, x: main.cx, y: main.cy, faces } : { t: i * STEP, x: null, y: null, faces };
  });
const jitter = (i) => ((i * 7919) % 11) / 1000 - 0.005;
const both = (i) => [face(0.25 + jitter(i)), face(0.75 - jitter(i))];
const one = () => [face(0.5)];
const plan = (facesAt, ratio) => planSplitSegments(samples(facesAt), W, H, ratio);

// ---- decisions -------------------------------------------------------------

const podcast = plan(both);
check(isWholeClip(podcast), 'two seated people far apart all clip -> one split covering it');
const l = podcast[0]?.layout;
check(l && Math.abs(l.top.cx - 0.25) < 0.02 && Math.abs(l.bottom.cx - 0.75) < 0.02,
  'left person on top, right person below, at their median positions');

check(plan(one).length === 0, 'one person -> no split');
check(plan(() => [face(0.45), face(0.55)]).length === 0, 'two people close enough for one 9:16 window -> no split');
check(plan(() => [face(0.3, 0.4, 0.1), face(0.85, 0.3, 0.02)]).length === 0, 'small background face -> no split');
check(plan((i) => [face(0.15 + (i % 2) * 0.2), face(0.85 - (i % 2) * 0.2)]).length === 0,
  'people moving around a lot -> no split');
check(plan(both, '1:1').length === 0, 'only 9:16 is split');

// Mid-clip switching: single for samples 0-9, both 10-29, single 30-39.
const mid = plan((i) => (i >= 10 && i < 30 ? both(i) : one()));
check(mid.length === 1 && Math.abs(mid[0].start - 9.5 * STEP) < 0.01 && Math.abs(mid[0].end - 29.5 * STEP) < 0.01,
  `split only while both are on camera (${mid.map((s) => `${s.start.toFixed(2)}-${s.end.toFixed(2)}s`).join(', ')})`);

const blips = plan((i) => (i === 5 || i === 22 ? one() : i === 35 ? both(i) : i < 30 ? both(i) : one()));
check(blips.length === 1 && blips[0].start === 0 && Math.abs(blips[0].end - 29.5 * STEP) < 0.01,
  'a missed detection does not cut a stretch, a stray pair does not start one');

const twoStretches = plan((i) => (i < 12 || i >= 26 ? both(i) : one()));
check(twoStretches.length === 2 && twoStretches[0].start === 0 && twoStretches[1].end === Infinity,
  'together, apart, together -> two split stretches reaching both ends');

check(plan((i) => (i >= 10 && i < 15 ? both(i) : one())).length === 0, 'under 2 s together -> no layout change');

const c = panelCrop(face(0.02), W, H, { w: 720, h: 1280 });
check(c.x >= 0 && c.y >= 0 && c.x + c.w <= W && c.y + c.h <= H && c.w % 2 === 0 && c.h % 2 === 0,
  `panel crop near the edge stays inside the frame, even-sized (${c.w}x${c.h}+${c.x}+${c.y})`);

// ---- real renders through buildArgs ----------------------------------------

const work = mkdtempSync(path.join(tmpdir(), 'flipcast-layout-'));
const ff = (args) => execFileSync(ffmpegPath, ['-v', 'error', '-y', ...args], { cwd: work });
const frameAt = (file, t, w, h) => {
  const raw = execFileSync(ffmpegPath, [
    '-v', 'error', '-ss', String(t), '-i', path.join(work, file), '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { maxBuffer: 64 * 1024 * 1024 });
  /** Strongly red and strongly blue pixels over rows y0..y1. */
  const count = (y0, y1) => {
    let red = 0, blue = 0;
    for (let y = y0; y < y1; y += 2) for (let x = 0; x < w; x += 2) {
      const o = (y * w + x) * 3;
      const [r, g, b] = [raw[o], raw[o + 1], raw[o + 2]];
      if (r > 180 && g < 80 && b < 80) red++;
      if (b > 180 && r < 80 && g < 80) blue++;
    }
    return { red, blue };
  };
  return { size: raw.length, top: count(0, h / 2), bottom: count(h / 2, h) };
};
const isSplit = (f) => f.top.red > 500 && f.top.blue === 0 && f.bottom.blue > 500 && f.bottom.red === 0;
try {
  // Grey stage, a red "person" on the left and a blue one on the right. The
  // centre 9:16 crop shows neither.
  const BOX = 160, D = 4;
  ff([
    '-f', 'lavfi', '-i', `color=gray:s=${W}x${H}:d=${D}:r=25`,
    '-f', 'lavfi', '-i', `color=red:s=${BOX}x${BOX}:d=${D}:r=25`,
    '-f', 'lavfi', '-i', `color=blue:s=${BOX}x${BOX}:d=${D}:r=25`,
    '-filter_complex',
    `[0][1]overlay=${0.25 * W - BOX / 2}:${0.4 * H - BOX / 2}[a];[a][2]overlay=${0.75 * W - BOX / 2}:${0.4 * H - BOX / 2}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', 'src.mp4',
  ]);
  const layout = { top: face(0.25, 0.4, BOX / W), bottom: face(0.75, 0.4, BOX / W) };

  // Whole clip, alongside a 16:9 output in the same pass.
  const whole = planRender(['9:16', '16:9'], { width: W, height: H });
  whole[0].split = { segments: [{ start: 0, end: Infinity, layout }], srcW: W, srcH: H };
  ff(buildArgs('src.mp4', whole));
  const { w, h } = whole[0].canvas;
  const f = frameAt(whole[0].outName, 1, w, h);
  check(f.size === w * h * 3, `split output is ${w}x${h}`);
  check(isSplit(f), `whole-clip split: left (red) on top, right (blue) below (${JSON.stringify(f)})`);
  const wide = execFileSync(ffmpegPath, [
    '-v', 'error', '-i', path.join(work, whole[1].outName), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
  ], { maxBuffer: 64 * 1024 * 1024 });
  check(wide.length === whole[1].canvas.w * whole[1].canvas.h, 'the 16:9 output in the same pass is unaffected');

  // Switching: normal centre crop, split from 1.0 to 2.5 s, then normal again.
  const sw = planRender(['9:16'], { width: W, height: H });
  sw[0].split = { segments: [{ start: 1, end: 2.5, layout }], srcW: W, srcH: H };
  ff(buildArgs('src.mp4', sw));
  const at = (t) => frameAt(sw[0].outName, t, w, h);
  const [before, during, after] = [at(0.5), at(1.8), at(3.2)];
  const plain = (fr) => fr.top.red + fr.top.blue + fr.bottom.red + fr.bottom.blue === 0;
  check(plain(before), `0.5 s: normal crop before the split (${JSON.stringify(before)})`);
  check(isSplit(during), `1.8 s: split screen during the stretch (${JSON.stringify(during)})`);
  check(plain(after), `3.2 s: back to the normal crop after it (${JSON.stringify(after)})`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(failed ? `\nLAYOUT: ${failed} FAILED` : '\nLAYOUT: ALL PASS');
process.exit(failed ? 1 : 0);
