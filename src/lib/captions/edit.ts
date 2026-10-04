/**
 * Editing a transcript before it is burned in as captions.
 *
 * The editor shows the transcript as short lines; the user retypes a line,
 * and its new words take over that line's time span, each word getting a
 * share proportional to its length so the highlight still moves with the
 * speech. Clearing a line removes its captions.
 *
 * Pure: shared by the editor (src/components/flipcast/caption-editor.tsx) and
 * scripts/verify-captions.mjs.
 */

import type { CaptionWord } from './captions';
import { fontFor, hanFontFor, SENTENCE_END, spaced } from './scripts';

/** One editable line: words[from..to] (inclusive) of the transcript. */
export type EditableLine = { from: number; to: number; start: number; end: number; text: string };

const MAX_LINE_WORDS = 14;
const LINE_PAUSE = 0.7;
/** Pieces of a run of CJK or Thai text with no spaces, as Whisper splits it. */
const UNSPACED_CHUNK = 4;

/** Whether a word is written in a script without spaces (Japanese, Chinese, Thai...). */
function unspaced(text: string, han: ReturnType<typeof hanFontFor>): boolean {
  return !spaced(fontFor(text, han));
}

/** Words joined as their scripts are written: no space between two unspaced words. */
export function joinWords(words: CaptionWord[]): string {
  const han = hanFontFor(words.map((w) => w.text).join(''));
  let out = '';
  words.forEach((w, i) => {
    const text = w.text.trim();
    if (i > 0 && !(unspaced(words[i - 1].text, han) && unspaced(text, han))) out += ' ';
    out += text;
  });
  return out;
}

/**
 * The transcript as short lines, for words that overlap `range` (seconds, in
 * the transcript's own timeline). Lines break at sentence ends, at pauses and
 * after a few words, so each fits in one text field.
 */
export function editableLines(words: CaptionWord[], range?: { start: number; end: number } | null): EditableLine[] {
  const lines: EditableLine[] = [];
  let from = -1;
  const flush = (to: number) => {
    if (from < 0) return;
    const slice = words.slice(from, to + 1);
    lines.push({ from, to, start: words[from].start, end: words[to].end, text: joinWords(slice) });
    from = -1;
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (range && (w.end <= range.start || w.start >= range.end)) {
      flush(i - 1);
      continue;
    }
    if (from >= 0) {
      const prev = words[i - 1];
      if (w.start - prev.end > LINE_PAUSE || i - from >= MAX_LINE_WORDS) flush(i - 1);
    }
    if (from < 0) from = i;
    if (SENTENCE_END.test(w.text.trim())) flush(i);
  }
  flush(words.length - 1);
  return lines;
}

/** The words of a retyped line: split on spaces, and long unspaced runs into short pieces. */
function tokenize(text: string): string[] {
  const han = hanFontFor(text);
  const out: string[] = [];
  for (const token of text.trim().split(/\s+/).filter(Boolean)) {
    const chars = [...token];
    if (chars.length > UNSPACED_CHUNK * 2 && unspaced(token, han)) {
      for (let i = 0; i < chars.length; i += UNSPACED_CHUNK) out.push(chars.slice(i, i + UNSPACED_CHUNK).join(''));
    } else {
      out.push(token);
    }
  }
  return out;
}

/**
 * Replace words[from..to] with the words of `text`, spread over the same time
 * span. Empty text removes them. Returns a new array; `words` is unchanged.
 */
export function replaceLine(words: CaptionWord[], from: number, to: number, text: string): CaptionWord[] {
  const start = words[from].start;
  const end = Math.max(start, words[to].end);
  const tokens = tokenize(text);
  // Each word gets time in proportion to its length, with a floor so short
  // words ("a", "I") still flash up long enough to read.
  const weights = tokens.map((t) => Math.max(2, [...t].length));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = start;
  const replaced = tokens.map((token, i) => {
    const d = ((end - start) * weights[i]) / total;
    const w = { text: token, start: t, end: i === tokens.length - 1 ? end : t + d };
    t += d;
    return w;
  });
  return [...words.slice(0, from), ...replaced, ...words.slice(to + 1)];
}
