/**
 * Writing systems in captions: which font draws each word, how wide it is,
 * and whether words in it are separated by spaces.
 *
 * The caption face, Anton, only has Latin glyphs, so Cyrillic, Arabic, CJK and
 * the rest would burn in as empty boxes. Each word is matched to a bold Noto
 * face for its script (public/fonts/captions, SIL OFL) and switched to it with
 * an ASS \fn override, so mixed lines (an English brand name in a Hindi
 * sentence) still draw every word. Fonts are fetched only when a transcript
 * needs them; the CJK ones are several megabytes.
 *
 * Pure (no browser or Node APIs), shared by captions.ts, the render engine
 * and scripts/verify-captions.mjs.
 */

export type CaptionFont = {
  /** Family name libass matches (name ID 1 inside the file). */
  family: string;
  /** Path under /fonts on the site, and under the engine's fonts dir. */
  file: string;
};

const noto = (name: string, file: string): CaptionFont => ({
  family: `Noto Sans${name ? ` ${name}` : ''} ExtraBold`,
  file: `captions/${file}-ExtraBold.ttf`,
});

export const FONTS = {
  latin: { family: 'Anton', file: 'Anton-Regular.ttf' },
  // Cyrillic, Greek, and Latin letters Anton lacks.
  noto: noto('', 'NotoSans'),
  arabic: noto('Arabic', 'NotoSansArabic'),
  hebrew: noto('Hebrew', 'NotoSansHebrew'),
  devanagari: noto('Devanagari', 'NotoSansDevanagari'),
  bengali: noto('Bengali', 'NotoSansBengali'),
  gujarati: noto('Gujarati', 'NotoSansGujarati'),
  gurmukhi: noto('Gurmukhi', 'NotoSansGurmukhi'),
  tamil: noto('Tamil', 'NotoSansTamil'),
  telugu: noto('Telugu', 'NotoSansTelugu'),
  kannada: noto('Kannada', 'NotoSansKannada'),
  malayalam: noto('Malayalam', 'NotoSansMalayalam'),
  sinhala: noto('Sinhala', 'NotoSansSinhala'),
  thai: noto('Thai', 'NotoSansThai'),
  lao: noto('Lao', 'NotoSansLao'),
  khmer: noto('Khmer', 'NotoSansKhmer'),
  myanmar: noto('Myanmar', 'NotoSansMyanmar'),
  georgian: noto('Georgian', 'NotoSansGeorgian'),
  armenian: noto('Armenian', 'NotoSansArmenian'),
  ethiopic: noto('Ethiopic', 'NotoSansEthiopic'),
  ja: noto('JP', 'NotoSansJP'),
  ko: noto('KR', 'NotoSansKR'),
  hans: noto('SC', 'NotoSansSC'),
  hant: noto('TC', 'NotoSansTC'),
} satisfies Record<string, CaptionFont>;

export type FontKey = keyof typeof FONTS;

/** Scripts with a dedicated face, checked in this order. */
const SCRIPT_FONTS: [RegExp, FontKey][] = [
  [/\p{Script=Hangul}/u, 'ko'],
  [/[\p{Script=Hiragana}\p{Script=Katakana}]/u, 'ja'],
  [/\p{Script=Arabic}/u, 'arabic'],
  [/\p{Script=Hebrew}/u, 'hebrew'],
  [/\p{Script=Devanagari}/u, 'devanagari'],
  [/\p{Script=Bengali}/u, 'bengali'],
  [/\p{Script=Gujarati}/u, 'gujarati'],
  [/\p{Script=Gurmukhi}/u, 'gurmukhi'],
  [/\p{Script=Tamil}/u, 'tamil'],
  [/\p{Script=Telugu}/u, 'telugu'],
  [/\p{Script=Kannada}/u, 'kannada'],
  [/\p{Script=Malayalam}/u, 'malayalam'],
  [/\p{Script=Sinhala}/u, 'sinhala'],
  [/\p{Script=Thai}/u, 'thai'],
  [/\p{Script=Lao}/u, 'lao'],
  [/\p{Script=Khmer}/u, 'khmer'],
  [/\p{Script=Myanmar}/u, 'myanmar'],
  [/\p{Script=Georgian}/u, 'georgian'],
  [/\p{Script=Armenian}/u, 'armenian'],
  [/\p{Script=Ethiopic}/u, 'ethiopic'],
  [/[\p{Script=Cyrillic}\p{Script=Greek}]/u, 'noto'],
];

const HAN = /\p{Script=Han}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;

/**
 * Characters that only occur in Traditional Chinese, common enough that any
 * real Traditional transcript contains some. Their Simplified forms differ.
 */
const TRADITIONAL =
  /[們這個說會來時對為學國開關門問題經發現與實點還過應該體機東車長電話語見聽買賣場愛親讓認識記書號萬歲總雖樣聲氣錢裡後際點頭樂習歡謝麼貓狗衛頁風飛馬魚鳥龍]/u;

/** Anton's coverage: Basic Latin, Latin-1, Latin Extended-A/B and Vietnamese. */
const ANTON = /^[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]*$/u;

/**
 * How Han characters should be drawn for this transcript. Decided once, so a
 * line never mixes Japanese and Chinese glyph shapes for the same character.
 */
export function hanFontFor(fullText: string): FontKey {
  if (KANA.test(fullText)) return 'ja';
  return TRADITIONAL.test(fullText) ? 'hant' : 'hans';
}

/** The face that draws `word`; `han` comes from {@link hanFontFor}. */
export function fontFor(word: string, han: FontKey): FontKey {
  for (const [re, key] of SCRIPT_FONTS) if (re.test(word)) return key;
  if (HAN.test(word)) return han;
  // Latin letters outside Anton (rare: IPA, some African alphabets).
  return ANTON.test(word) ? 'latin' : 'noto';
}

/** Scripts written without spaces between words. */
const NO_SPACE = new Set<FontKey>(['ja', 'hans', 'hant', 'thai', 'lao', 'khmer', 'myanmar']);

export function spaced(key: FontKey): boolean {
  return !NO_SPACE.has(key);
}

/** Full-width faces; other non-Latin faces are wider than condensed Anton. */
const WIDE = new Set<FontKey>(['ja', 'ko', 'hans', 'hant']);

/**
 * Display width of `text` in Anton-letter units, for line breaking. Combining
 * marks (Indic vowel signs, Arabic harakat, Thai tone marks) take no width.
 */
export function displayWidth(text: string, key: FontKey): number {
  const perChar = WIDE.has(key) ? 2 : key === 'latin' ? 1 : 1.4;
  let n = 0;
  for (const ch of text) if (!/\p{M}/u.test(ch)) n += perChar;
  return n;
}

/** Sentence-ending punctuation across scripts: . ! ? 。！？ ؟ । ። ။ */
export const SENTENCE_END = /[.!?。！？؟।॥።။]$/u;
