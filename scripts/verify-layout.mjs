/**
 * Verifies the split-screen layout with the app's own modules and a real ffmpeg:
 *
 *  - two seated people too far apart for one 9:16 window -> split screen,
 *    left person on top;
 *  - one person, two people close together, two people only briefly on camera
 *    together, a small background face, or people walking around -> no split;
 *  - the real filtergraph from buildArgs renders a 9:16 output alongside a
 *    16:9 one, with the left subject in the top half and the right subject in
 *    the bottom half.
 *
 * Run: npm run verify:layout
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

import { buildArgs, planRender } from '../src/lib/video/ffmpeg-client.ts';
import { panelCrop, planSplit } from '../src/lib/video/layout.ts';

let failed = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
};

const W = 1920, H = 1080;
const N = 40;
const face = (cx, cy = 0.4, w = 0.08) => ({ cx, cy, w });
/** N samples; `facesAt(i)` gives the faces in sample i. */
const samples = (facesAt) =>
  Array.from({ length: N }, (_, i) => {
    const faces = facesAt(i);
    const main = faces[0];
    return main ? { t: i * 0.3, x: main.cx, y: main.cy, faces } : { t: i * 0.3, x: null, y: null, faces };
  });
const jitter = (i) => ((i * 7919) % 11) / 1000 - 0.005;

// ---- decisions -------------------------------------------------------------

const podcast = planSplit(samples((i) => [face(0.25 + jitter(i)), face(0.75 - jitter(i))]), W, H);
check(podcast !== null, 'two seated people far apart -> split screen');
check(podcast && Math.abs(podcast.top.cx - 0.25) < 0.02 && Math.abs(podcast.bottom.cx - 0.75) < 0.02,
  'left person on top, right person below, at their median positions');

check(planSplit(samples(() => [face(0.6)]), W, H) === null, 'one person -> no split');
check(planSplit(samples(() => [face(0.45), face(0.55)]), W, H) === null,
  'two people close enough for one 9:16 window -> no split');
check(planSplit(samples((i) => (i < N * 0.3 ? [face(0.25), face(0.75)] : [face(0.5)])), W, H) === null,
  'two people together only 30% of the clip -> no split');
check(planSplit(samples(() => [face(0.3, 0.4, 0.1), face(0.85, 0.3, 0.02)]), W, H) === null,
  'small background face -> no split');
check(planSplit(samples((i) => [face(0.15 + (i % 2) * 0.2), face(0.85 - (i % 2) * 0.2)]), W, H) === null,
  'people moving around a lot -> no split');
check(planSplit(samples(() => [face(0.25), face(0.75)]), W, H, '1:1') === null,
  'only 9:16 is split');

const c = panelCrop(face(0.02), W, H, { w: 720, h: 1280 });
check(c.x >= 0 && c.y >= 0 && c.x + c.w <= W && c.y + c.h <= H && c.w % 2 === 0 && c.h % 2 === 0,
  `panel crop near the edge stays inside the frame, even-sized (${c.w}x${c.h}+${c.x}+${c.y})`);

// ---- real render through buildArgs -----------------------------------------

const work = mkdtempSync(path.join(tmpdir(), 'flipcast-layout-'));
const ff = (args) => execFileSync(ffmpegPath, ['-v', 'error', '-y', ...args], { cwd: work });
try {
  // Grey stage, a red "person" on the left and a blue one on the right.
  const BOX = 160;
  ff([
    '-f', 'lavfi', '-i', `color=gray:s=${W}x${H}:d=2:r=25`,
    '-f', 'lavfi', '-i', `color=red:s=${BOX}x${BOX}:d=2:r=25`,
    '-f', 'lavfi', '-i', `color=blue:s=${BOX}x${BOX}:d=2:r=25`,
    '-filter_complex',
    `[0][1]overlay=${0.25 * W - BOX / 2}:${0.4 * H - BOX / 2}[a];[a][2]overlay=${0.75 * W - BOX / 2}:${0.4 * H - BOX / 2}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', 'src.mp4',
  ]);

  const layout = { top: face(0.25, 0.4, BOX / W), bottom: face(0.75, 0.4, BOX / W) };
  const plan = planRender(['9:16', '16:9'], { width: W, height: H });
  plan[0].split = { layout, srcW: W, srcH: H };
  ff(buildArgs('src.mp4', plan));

  const vert = plan[0];
  const raw = execFileSync(ffmpegPath, [
    '-v', 'error', '-ss', '1', '-i', path.join(work, vert.outName), '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { maxBuffer: 64 * 1024 * 1024 });
  const { w, h } = vert.canvas;
  check(raw.length === w * h * 3, `split output is ${w}x${h}`);

  /** Count strongly red and strongly blue pixels over rows y0..y1. */
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
  const top = count(0, h / 2);
  const bottom = count(h / 2, h);
  check(top.red > 500 && top.blue === 0, `top half shows only the left (red) subject (${JSON.stringify(top)})`);
  check(bottom.blue > 500 && bottom.red === 0, `bottom half shows only the right (blue) subject (${JSON.stringify(bottom)})`);

  const wide = execFileSync(ffmpegPath, [
    '-v', 'error', '-i', path.join(work, plan[1].outName), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
  ], { maxBuffer: 64 * 1024 * 1024 });
  check(wide.length === plan[1].canvas.w * plan[1].canvas.h, 'the 16:9 output in the same pass is unaffected');
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(failed ? `\nLAYOUT: ${failed} FAILED` : '\nLAYOUT: ALL PASS');
process.exit(failed ? 1 : 0);
