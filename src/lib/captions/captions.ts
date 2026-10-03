/**
 * Caption layout: from word timings to burned-in subtitles and an .srt file.
 *
 * Pure (no browser or Node APIs) so the render engine and the verification
 * scripts share it. Words come from the on-device transcriber
 * (transcribe.worker.ts); this module groups them into short, punchy lines in
 * the style of TikTok and Reels captions and writes them as ASS, which FFmpeg's
 * libass renders straight onto the video.
 */

import type { Ratio } from '../video/geometry';
import {
  FONTS,
  SENTENCE_END,
  displayWidth,
  fontFor,
  hanFontFor,
  spaced,
  type CaptionFont,
  type FontKey,
} from './scripts';

export type CaptionWord = { text: string; start: number; end: number };

export type CaptionStyleId = 'bold' | 'pop' | 'clean';

export const CAPTION_STYLES: { id: CaptionStyleId; name: string; desc: string }[] = [
  { id: 'bold', name: 'Bold', desc: 'White, heavy outline, the active word in yellow' },
  { id: 'pop', name: 'Pop', desc: 'White with the active word in hot pink' },
  { id: 'clean', name: 'Clean', desc: 'Plain white on a soft dark box' },
];

/** A word with the face that draws it (scripts.ts). */
export type TaggedWord = CaptionWord & { font: FontKey };

/** A line shown on screen at once. */
export type CaptionGroup = { words: TaggedWord[]; start: number; end: number };

/** Longest line, in Anton-letter widths (scripts.displayWidth), per shape. */
const MAX_CHARS: Record<Ratio, number> = { '9:16': 16, '1:1': 22, '16:9': 34 };
const MAX_WORDS: Record<Ratio, number> = { '9:16': 3, '1:1': 4, '16:9': 7 };
/** A pause this long (seconds) always starts a new line. */
const PAUSE_BREAK = 0.6;

/** Clean the transcriber's word tokens: trim, drop empties, keep order and times. */
export function normalizeWords(words: CaptionWord[]): CaptionWord[] {
  return words
    .map((w) => ({ text: w.text.trim(), start: Math.max(0, w.start), end: Math.max(w.start, w.end) }))
    .filter((w) => w.text.length > 0 && Number.isFinite(w.start) && Number.isFinite(w.end))
    .sort((a, b) => a.start - b.start);
}

/** Normalised words, each tagged with the face for its script. */
export function tagWords(words: CaptionWord[]): TaggedWord[] {
  const clean = normalizeWords(words);
  const han = hanFontFor(clean.map((w) => w.text).join(''));
  return clean.map((w) => ({ ...w, font: fontFor(w.text, han) }));
}

/** Every face a transcript needs, Anton first. Fetch these before rendering. */
export function captionFonts(words: CaptionWord[]): CaptionFont[] {
  const keys = new Set<FontKey>(['latin', ...tagWords(words).map((w) => w.font)]);
  return [...keys].map((k) => FONTS[k]);
}

/** A space between two words, unless both are in a script written without them. */
const gap = (a: TaggedWord, b: TaggedWord) => (spaced(a.font) || spaced(b.font) ? ' ' : '');

/** Join words the way their scripts are written, after mapping each with `map`. */
function joinWords(words: TaggedWord[], map: (w: TaggedWord, i: number) => string = (w) => w.text): string {
  return words.map((w, i) => (i ? gap(words[i - 1], w) : '') + map(w, i)).join('');
}

/** Group words into lines that fit the shape, breaking on pauses and sentence ends. */
export function groupWords(words: CaptionWord[], ratio: Ratio): CaptionGroup[] {
  const groups: CaptionGroup[] = [];
  let cur: TaggedWord[] = [];
  let width = 0;
  const flush = () => {
    if (cur.length) groups.push({ words: cur, start: cur[0].start, end: cur[cur.length - 1].end });
    cur = [];
    width = 0;
  };
  for (const w of tagWords(words)) {
    const prev = cur[cur.length - 1];
    const add = (prev ? gap(prev, w).length : 0) + displayWidth(w.text, w.font);
    if (
      prev &&
      // The word cap is for spaced scripts: a CJK or Thai "word" from the
      // transcriber is often a single character, so width alone decides.
      ((cur.length >= MAX_WORDS[ratio] && spaced(w.font)) ||
        width + add > MAX_CHARS[ratio] ||
        w.start - prev.end > PAUSE_BREAK ||
        SENTENCE_END.test(prev.text))
    ) {
      flush();
    }
    width += cur.length ? add : displayWidth(w.text, w.font);
    cur.push(w);
  }
  flush();
  // Hold each line until the next starts (up to a short tail) so text does not
  // flicker off between words.
  for (let i = 0; i < groups.length; i++) {
    const next = groups[i + 1];
    const hold = next ? Math.min(next.start, groups[i].end + 0.5) : groups[i].end + 0.5;
    groups[i].end = Math.max(groups[i].end, hold);
  }
  return groups;
}

/** ASS timestamp: H:MM:SS.cc */
function assTime(s: number): string {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/** SRT timestamp: HH:MM:SS,mmm */
function srtTime(s: number): string {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}

/** Escape text for an ASS Dialogue line (braces start override tags). */
function assText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/[{}]/g, '').replace(/\n/g, ' ');
}

// ASS colours are &HAABBGGRR (alpha first, then blue, green, red).
const WHITE = '&H00FFFFFF';
const BLACK = '&H00000000';
const BOX = '&H66000000';
// Inline \c overrides take BBGGRR with no alpha byte.
const YELLOW_BGR = '00E5FF';
const PINK_BGR = '9C3DFF';
const WHITE_BGR = 'FFFFFF';

/**
 * A complete ASS script for one output canvas.
 *
 * PlayRes equals the canvas, so sizes and margins are in output pixels and no
 * scaling distorts the glyphs. Words are upper-cased, as short-form captions
 * usually are. For highlight styles every word gets its own event, with the
 * line drawn in full and the word being spoken recoloured.
 */
export function buildAss(
  words: CaptionWord[],
  ratio: Ratio,
  canvas: { w: number; h: number },
  style: CaptionStyleId,
): string {
  const { w, h } = canvas;
  const vertical = ratio === '9:16';
  const fontSize = Math.round((vertical ? w * 0.11 : ratio === '1:1' ? w * 0.08 : h * 0.075));
  // Vertical: sit above the caption/username overlay platforms draw at the
  // bottom. Square and landscape: the usual lower third.
  const marginV = Math.round(h * (vertical ? 0.24 : ratio === '1:1' ? 0.12 : 0.08));
  const marginH = Math.round(w * 0.06);
  const clean = style === 'clean';
  const outline = clean ? Math.round(fontSize * 0.18) : Math.max(3, Math.round(fontSize * 0.09));
  const shadow = clean ? 0 : Math.max(1, Math.round(fontSize * 0.04));
  // BorderStyle 3 draws an opaque box behind the text; 1 draws an outline.
  const borderStyle = clean ? 3 : 1;
  const outlineColour = clean ? BOX : BLACK;
  const highlight = style === 'bold' ? YELLOW_BGR : style === 'pop' ? PINK_BGR : null;

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Caption,${FONTS.latin.family},${fontSize},${WHITE},${WHITE},${outlineColour},${BOX},0,0,0,0,100,100,1,0,${borderStyle},${outline},${shadow},2,${marginH},${marginH},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const events: string[] = [];
  for (const g of groupWords(words, ratio)) {
    // Each word names its face, so a line can mix scripts (see scripts.ts).
    const texts = g.words.map((x) => `{\\fn${FONTS[x.font].family}}${assText(x.text.toUpperCase())}`);
    if (!highlight) {
      events.push(`Dialogue: 0,${assTime(g.start)},${assTime(g.end)},Caption,,0,0,0,,${joinWords(g.words, (_, i) => texts[i])}`);
      continue;
    }
    g.words.forEach((word, i) => {
      const start = i === 0 ? g.start : word.start;
      const end = i < g.words.length - 1 ? g.words[i + 1].start : g.end;
      if (end <= start) return;
      const line = joinWords(g.words, (_, j) =>
        j === i ? `{\\c&H${highlight}&}${texts[j]}{\\c&H${WHITE_BGR}&}` : texts[j],
      );
      events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Caption,,0,0,0,,${line}`);
    });
  }
  return [...header, ...events, ''].join('\n');
}

/** Standard .srt, for uploading as a separate caption track (YouTube, TikTok). */
export function buildSrt(words: CaptionWord[]): string {
  // Landscape grouping gives readable sentence-length cues for a caption track.
  return groupWords(words, '16:9')
    .map(
      (g, i) =>
        `${i + 1}\n${srtTime(g.start)} --> ${srtTime(g.end)}\n${joinWords(g.words)}\n`,
    )
    .join('\n');
}
