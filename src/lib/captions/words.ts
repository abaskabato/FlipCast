/**
 * Cleaning up Whisper's word-level output before it becomes captions.
 *
 * Two problems come straight from how transformers.js splits the decoded
 * tokens into words:
 *
 *  - Elision: Whisper marks the start of a word with a leading space, so in
 *    French " j" "'adore" is one word, j'adore, and " aujourd" "'hui" is
 *    aujourd'hui. Pieces that start with an apostrophe are glued back on.
 *  - Split characters: a CJK character (or emoji) can span two tokens, and
 *    each half decodes on its own to U+FFFD "�". The full transcript is
 *    decoded in one go, so each broken piece is repaired from the matching
 *    stretch of it. Occasionally the model emits bytes that are not a
 *    character at all, and the full text has "�" too; that is removed, since
 *    there is nothing to recover.
 *
 * Pure: shared by the transcription worker and scripts/verify-captions.mjs.
 */

export type RawWord = { text: string; start: number; end: number };

const REPLACEMENT = '\uFFFD';
const ELISION_START = /^['’ʼ]/u;
/** How far ahead of the last match a word may be found. */
const MAX_SKIP = 12;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replace "�" runs in `words` with the characters they stand for in
 * `fullText` (the same transcript, decoded whole). Words are matched in
 * order; a word that cannot be placed just loses its "�".
 */
export function repairSplitCharacters(words: RawWord[], fullText: string): RawWord[] {
  if (!words.some((w) => w.text.includes(REPLACEMENT))) return words;
  let at = 0;
  // Whether the previous word was found, so `at` is a trustworthy position.
  let anchored = true;
  return words.map((w, i) => {
    const broken = w.text.includes(REPLACEMENT);
    // Each "�" run stands for one to four characters; the rest must match
    // exactly. When a character was split between two words, the first takes
    // it and the second just loses its "�".
    // A trailing run takes what is left of the word, so the last character
    // of a word is not handed to the next one.
    const parts = w.text.trim().split(new RegExp(`${REPLACEMENT}+`, 'u'));
    const last = i === words.length - 1 || (w.text.trim().endsWith(REPLACEMENT) && /^\s/.test(words[i + 1].text));
    const pattern = parts
      .map(escape)
      .map((part, j) => (j === 0 ? part : (j === parts.length - 1 && part === '' && last ? '[^\\s]{1,4}' : '[\\s\\S]{1,4}?') + part))
      .join('');
    const re = new RegExp(`\\s*${pattern}`, 'gu');
    re.lastIndex = at;
    const m = pattern ? re.exec(fullText) : null;
    // Only accept a match close to where the previous word ended; a word that
    // is nothing but "\uFFFD" has no text of its own to confirm the place, so
    // it must follow straight on from a word that was found.
    const onlyBroken = parts.every((part) => part === '');
    const ok = m && m[0].trim() && (onlyBroken ? anchored && m.index === at : m.index - at <= MAX_SKIP);
    anchored = Boolean(ok);
    if (m && ok) {
      at = m.index + m[0].length;
      return broken ? { ...w, text: (/^\s/.test(w.text) ? ' ' : '') + m[0].trim() } : w;
    }
    return broken ? { ...w, text: w.text.split(REPLACEMENT).join('') } : w;
  });
}

/** Glue pieces that start with an apostrophe onto the word before them. */
export function joinElisions(words: RawWord[]): RawWord[] {
  const out: RawWord[] = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    if (prev && ELISION_START.test(w.text) && !/\s$/.test(prev.text)) {
      out[out.length - 1] = { text: prev.text + w.text, start: prev.start, end: w.end };
    } else {
      out.push({ ...w });
    }
  }
  return out;
}

/** Whisper's words for one segment, ready for captions. */
export function cleanWords(words: RawWord[], fullText: string): RawWord[] {
  return joinElisions(repairSplitCharacters(words, fullText))
    .map((w) => ({ ...w, text: w.text.split(REPLACEMENT).join('').trim() }))
    .filter((w) => w.text !== '');
}
