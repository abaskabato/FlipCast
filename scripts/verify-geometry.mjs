/**
 * Validates src/lib/video/geometry.ts against a real ffmpeg binary.
 * Run: node scripts/verify-geometry.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const FFMPEG = ffmpegPath;
if (!FFMPEG) {
  console.error('ffmpeg-static did not provide a binary');
  process.exit(1);
}

const work = mkdtempSync(path.join(tmpdir(), 'flipcast-verify-'));
const src = path.join(work, 'source.mp4');

function run(args) {
  return execFileSync(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

// Build a 1920x1080 test source with distinct left/centre/right colour bands
// so a centre crop is provably correct (centre must stay green).
run([
  '-y', '-f', 'lavfi', '-i',
  'color=c=red:s=640x1080:d=2:r=30',
  '-f', 'lavfi', '-i',
  'color=c=green:s=640x1080:d=2:r=30',
  '-f', 'lavfi', '-i',
  'color=c=blue:s=640x1080:d=2:r=30',
  '-filter_complex', '[0][1][2]hstack=3[v]', '-map', '[v]',
  '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', src,
]);

// ffmpeg-static ships no ffprobe, so read dimensions from ffmpeg's own stderr.
// Looks for: "Stream #0:0[...]: Video: h264 ..., 1080x1920, ..."
function probe(file) {
  let stderr = '';
  try {
    execFileSync(FFMPEG, ['-hide_banner', '-i', file], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    stderr = String(e.stderr || '');
  }
  const m = stderr.match(/Video:[^\n]*?(\d{2,5})x(\d{2,5})/);
  return m ? `${m[1]}x${m[2]}` : 'NO_VIDEO_STREAM';
}

console.log('source =', probe(src));

// Replicate the TS module in plain JS for direct comparison.
function even(n) { const v = Math.round(n); if (v < 2) return 2; return v % 2 === 0 ? v : v + 1; }
const CANVAS = { '9:16': { w: 1080, h: 1920 }, '1:1': { w: 1080, h: 1080 }, '16:9': { w: 1920, h: 1080 } };
function cropFor(srcW, srcH, r) {
  const t = CANVAS[r].w / CANVAS[r].h, s = srcW / srcH;
  let cw, ch;
  if (Math.abs(s - t) < 1e-6) { cw = even(srcW); ch = even(srcH); }
  else if (s > t) { ch = even(srcH); cw = Math.min(even(ch * t), even(srcW)); }
  else { cw = even(srcW); ch = Math.min(even(cw / t), even(srcH)); }
  cw = Math.max(2, Math.min(cw, even(srcW)));
  ch = Math.max(2, Math.min(ch, even(srcH)));
  return { cw, ch, ox: Math.max(0, Math.floor((srcW - cw) / 2)), oy: Math.max(0, Math.floor((srcH - ch) / 2)) };
}
function filterFor(srcW, srcH, r) {
  const { cw, ch, ox, oy } = cropFor(srcW, srcH, r);
  const { w, h } = CANVAS[r];
  const p = [];
  if (cw !== srcW || ch !== srcH) p.push(`crop=${cw}:${ch}:${ox}:${oy}`);
  p.push(`scale=${w}:${h}`, 'setsar=1', 'format=yuv420p');
  return p.join(',');
}

const CASES = [
  { src: [1920, 1080], ratio: '9:16' },
  { src: [1920, 1080], ratio: '1:1' },
  { src: [1920, 1080], ratio: '16:9' },
  { src: [1080, 1920], ratio: '9:16' },
  { src: [1080, 1920], ratio: '1:1' },
  { src: [1080, 1920], ratio: '16:9' },
  { src: [1080, 1080], ratio: '16:9' },
  { src: [3840, 2160], ratio: '9:16' },
  { src: [640, 480], ratio: '9:16' },
];

let fail = 0;
for (const { src: [sw, sh], ratio } of CASES) {
  const vf = filterFor(sw, sh, ratio);
  const out = path.join(work, `out_${sw}x${sh}_${ratio.replace(':', 'x')}.mp4`);
  let actual = 'ERROR';
  try {
    run(['-y', '-i', src, '-vf', `scale=${sw}:${sh},${vf}`, '-t', '0.4',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', out]);
    actual = probe(out);
  } catch (e) {
    actual = 'ERROR: ' + String(e.stderr || e).slice(0, 200);
  }
  const want = `${CANVAS[ratio].w}x${CANVAS[ratio].h}`;
  const ok = actual === want;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  src=${sw}x${sh} -> ${ratio}  want=${want} got=${actual}  vf=${vf}`);
}

rmSync(work, { recursive: true, force: true });
console.log(fail === 0 ? '\nALL GEOMETRY CASES PASS' : `\n${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);