/**
 * Verifies burned-in captions with a real ffmpeg + libass, using the app's own
 * caption module (src/lib/captions/captions.ts) and bundled font:
 *
 *  - every style renders on every output shape;
 *  - text lands in the lower part of the frame, not the top;
 *  - highlight styles colour the word being spoken (yellow / pink pixels);
 *  - lines respect the per-shape length limits;
 *  - the .srt is well formed.
 *
 * Run: npm run verify:captions
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

import { buildAss, buildSrt, groupWords } from '../src/lib/captions/captions.ts';

const work = mkdtempSync(path.join(tmpdir(), 'flipcast-captions-'));
const fontsDir = path.resolve(import.meta.dirname, '..', 'public', 'fonts');

const WORDS = [
  ['this', 0.2, 0.5], ['is', 0.5, 0.7], ['how', 0.7, 1.0], ['you', 1.0, 1.2],
  ['flip', 1.2, 1.6], ['one', 1.6, 1.9], ['clip', 1.9, 2.3], ['into', 2.3, 2.6],
  ['every', 2.6, 3.0], ['format.', 3.0, 3.5],
].map(([text, start, end]) => ({ text, start, end }));

const CANVAS = { '9:16': { w: 720, h: 1280 }, '1:1': { w: 720, h: 720 }, '16:9': { w: 1280, h: 720 } };

let fail = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) fail++;
};

/** RGB frame at time t of a grey clip with captions burned in. */
function frameWithCaptions(ratio, style, t) {
  const { w, h } = CANVAS[ratio];
  const ass = path.join(work, `${ratio.replace(':', 'x')}-${style}.ass`);
  writeFileSync(ass, buildAss(WORDS, ratio, { w, h }, style));
  return execFileSync(ffmpegPath, [
    '-v', 'error', '-f', 'lavfi', '-i', `color=0x404040:s=${w}x${h}:d=4:r=25`,
    '-vf', `subtitles=filename=${ass}:fontsdir=${fontsDir}`,
    '-ss', String(t), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { maxBuffer: 64 * 1024 * 1024 });
}

for (const ratio of ['9:16', '1:1', '16:9']) {
  const { w, h } = CANVAS[ratio];
  for (const style of ['bold', 'pop', 'clean']) {
    // t=1.3: "flip" is being spoken.
    const px = frameWithCaptions(ratio, style, 1.3);
    let white = 0, top = 0, yellow = 0, pink = 0;
    for (let i = 0; i < w * h; i++) {
      const r = px[i * 3], g = px[i * 3 + 1], b = px[i * 3 + 2];
      const y = Math.floor(i / w);
      if (r > 230 && g > 230 && b > 230) { white++; if (y < h * 0.4) top++; }
      if (r > 220 && g > 190 && b < 80) yellow++;
      if (r > 220 && g < 110 && b > 110) pink++;
    }
    check(white > 200 && top === 0, `${ratio.padEnd(5)} ${style.padEnd(6)} text drawn in the lower frame (${white} px)`);
    if (style === 'bold') check(yellow > 50, `${ratio.padEnd(5)} bold   active word highlighted yellow (${yellow} px)`);
    if (style === 'pop') check(pink > 50, `${ratio.padEnd(5)} pop    active word highlighted pink (${pink} px)`);
    if (style === 'clean') check(yellow === 0 && pink < 10, `${ratio.padEnd(5)} clean  no highlight colour`);
  }
  const groups = groupWords(WORDS, ratio);
  const longest = Math.max(...groups.map((g) => g.words.map((x) => x.text).join(' ').length));
  const limit = { '9:16': 16, '1:1': 22, '16:9': 34 }[ratio];
  check(longest <= limit, `${ratio.padEnd(5)} lines at most ${limit} chars (longest ${longest})`);
}

const srt = buildSrt(WORDS);
check(/^1\n00:00:00,200 --> 00:00:0\d,\d{3}\nthis is how/.test(srt), '.srt is numbered, timed and readable');
check(srt.includes('format.'), '.srt keeps punctuation');

// No speech -> no events, still a valid script.
const empty = buildAss([], '9:16', CANVAS['9:16'], 'bold');
check(empty.includes('[Events]') && !empty.includes('Dialogue:'), 'no words -> valid script with no captions');

rmSync(work, { recursive: true, force: true });
console.log(fail ? `\nCAPTIONS: ${fail} FAILED` : '\nCAPTIONS: ALL PASS');
process.exit(fail ? 1 : 0);
