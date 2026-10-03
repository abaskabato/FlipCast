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
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

import { buildAss, buildSrt, captionFonts, groupWords, tagWords } from '../src/lib/captions/captions.ts';
import { FONTS, hanFontFor } from '../src/lib/captions/scripts.ts';

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

// ---- non-Latin scripts -------------------------------------------------------

/** Every code point a TrueType font maps (cmap formats 4 and 12). */
function cmapOf(file) {
  const b = readFileSync(file);
  let cmap = 0;
  for (let i = 0, n = b.readUInt16BE(4); i < n; i++) {
    if (b.toString('ascii', 12 + i * 16, 16 + i * 16) === 'cmap') cmap = b.readUInt32BE(20 + i * 16);
  }
  const cps = new Set();
  for (let i = 0, n = b.readUInt16BE(cmap + 2); i < n; i++) {
    const off = cmap + b.readUInt32BE(cmap + 4 + i * 8 + 4);
    const format = b.readUInt16BE(off);
    if (format === 4) {
      const segs = b.readUInt16BE(off + 6) / 2;
      for (let k = 0; k < segs; k++) {
        const end = b.readUInt16BE(off + 14 + k * 2);
        const start = b.readUInt16BE(off + 16 + segs * 2 + k * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) cps.add(c);
      }
    } else if (format === 12) {
      for (let k = 0, groups = b.readUInt32BE(off + 12); k < groups; k++) {
        const g = off + 16 + k * 12;
        for (let c = b.readUInt32BE(g); c <= b.readUInt32BE(g + 4); c++) cps.add(c);
      }
    }
  }
  return cps;
}
const cmaps = new Map();
const covers = (font, text) => {
  if (!cmaps.has(font.file)) cmaps.set(font.file, cmapOf(path.join(fontsDir, font.file)));
  const cps = cmaps.get(font.file);
  return [...text].filter((ch) => !/\s/u.test(ch) && !cps.has(ch.codePointAt(0)));
};

const words = (list) => list.map((text, i) => ({ text, start: 0.2 + i * 0.4, end: 0.55 + i * 0.4 }));
const SAMPLES = {
  ja: ['今日は', 'いい', '天気', 'ですね。'],
  'zh-Hans': ['我们', '今天', '学习', '中文。'],
  'zh-Hant': ['我們', '今天', '學習', '中文。'],
  ko: ['안녕하세요', '만나서', '반갑습니다.'],
  ar: ['مرحبا', 'بكم', 'في', 'البرنامج.'],
  he: ['שלום', 'לכולם', 'היום.'],
  hi: ['नमस्ते', 'आप', 'कैसे', 'हैं।'],
  bn: ['আমি', 'বাংলায়', 'কথা', 'বলি।'],
  ta: ['வணக்கம்', 'நண்பர்களே.'],
  te: ['నమస్కారం', 'మిత్రులారా.'],
  kn: ['ನಮಸ್ಕಾರ', 'ಸ್ನೇಹಿತರೇ.'],
  ml: ['നമസ്കാരം', 'സുഹൃത്തുക്കളേ.'],
  gu: ['નમસ્તે', 'મિત્રો.'],
  pa: ['ਸਤ', 'ਸ੍ਰੀ', 'ਅਕਾਲ'],
  si: ['ආයුබෝවන්', 'මිතුරනි.'],
  th: ['สวัสดี', 'ครับ', 'ทุก', 'คน'],
  lo: ['ສະບາຍດີ', 'ໝູ່'],
  km: ['សួស្តី', 'មិត្ត'],
  my: ['မင်္ဂလာပါ', 'သူငယ်ချင်း'],
  ru: ['Привет,', 'как', 'дела?'],
  uk: ['Їжак', 'ґанок', 'є.'],
  el: ['Καλημέρα', 'σε', 'όλους.'],
  ka: ['გამარჯობა', 'მეგობრებო.'],
  hy: ['Բարև', 'ձեզ.'],
  am: ['ሰላም', 'ለሁሉም።'],
  vi: ['Xin', 'chào', 'các', 'bạn', 'nhé.'],
  'hi+en': ['मैं', 'iPhone', 'use', 'करता', 'हूँ।'],
};

// Every character, as burned in (upper-cased), exists in the face chosen for it.
for (const [lang, list] of Object.entries(SAMPLES)) {
  const missing = tagWords(words(list)).flatMap((w) => covers(FONTS[w.font], w.text.toUpperCase()));
  const faces = [...new Set(tagWords(words(list)).map((w) => FONTS[w.font].family))].join(' + ');
  check(missing.length === 0, `${lang.padEnd(7)} every glyph present in ${faces}${missing.length ? ` (missing ${missing.join('')})` : ''}`);
}

check(hanFontFor('今日はいい天気') === 'ja', 'Han with kana -> Japanese face');
check(hanFontFor('我們今天學習') === 'hant', 'Traditional characters -> Traditional Chinese face');
check(hanFontFor('我们今天学习') === 'hans', 'Simplified characters -> Simplified Chinese face');

const jaSrt = buildSrt(words(SAMPLES.ja));
check(jaSrt.includes('今日はいい天気ですね。'), 'Japanese is joined without spaces');
check(buildSrt(words(SAMPLES['zh-Hans'])).includes('我们今天学习中文。'), 'Chinese is joined without spaces');
check(buildSrt(words(SAMPLES['hi+en'])).includes('मैं iPhone use करता हूँ।'), 'Hindi + English keep their spaces');

const longZh = words(Array.from('我们今天一起学习怎么把一个视频变成适合每个平台的短视频格式'));
const zhLines = groupWords(longZh, '9:16').map((g) => g.words.map((w) => w.text).join(''));
check(zhLines.length > 1 && zhLines.every((l) => l.length <= 8), `Chinese 9:16 lines fit the frame (${zhLines.map((l) => l.length).join(', ')} chars)`);

const needed = captionFonts(words(SAMPLES['hi+en'])).map((f) => f.family);
check(needed.includes('Anton') && needed.includes('Noto Sans Devanagari ExtraBold') && needed.length === 2,
  'only the faces a transcript needs are fetched');

// Real libass, with faces laid out flat as the engine does: no glyph may fall
// back to another font (libass logs "Glyph ... not found" when one does).
const langWork = mkdtempSync(path.join(tmpdir(), 'flipcast-captions-lang-'));
const flat = path.join(langWork, 'fonts');
mkdirSync(flat);
for (const f of Object.values(FONTS)) copyFileSync(path.join(fontsDir, f.file), path.join(flat, path.basename(f.file)));
for (const [lang, list] of Object.entries(SAMPLES)) {
  const ass = path.join(langWork, `lang-${lang}.ass`);
  writeFileSync(ass, buildAss(words(list), '9:16', { w: 720, h: 1280 }, 'bold'));
  const run = spawnSync(ffmpegPath, [
    '-v', 'verbose', '-f', 'lavfi', '-i', 'color=0x404040:s=720x1280:d=1:r=25',
    '-vf', `subtitles=filename=${ass}:fontsdir=${flat}`, '-frames:v', '1', '-f', 'null', '-',
  ], { encoding: 'utf8' });
  const log = run.stderr ?? '';
  const misses = log.split('\n').filter((l) => /not found|fontselect.*fallback|Error opening font/i.test(l));
  check(run.status === 0 && misses.length === 0, `${lang.padEnd(7)} libass draws it with no font fallback${misses.length ? `: ${misses[0].trim()}` : ''}`);
}
rmSync(langWork, { recursive: true, force: true });

console.log(fail ? `\nCAPTIONS: ${fail} FAILED` : '\nCAPTIONS: ALL PASS');
process.exit(fail ? 1 : 0);
