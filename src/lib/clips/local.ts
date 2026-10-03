/**
 * On-device clip finding: ranks stretches of a transcript the way an editor
 * would, with no model and no network, so it is free and the transcript never
 * leaves the device.
 *
 * Each candidate (a run of whole transcript lines of about the requested
 * length) is scored on:
 *
 *  - the hook: does the first line grab attention cold (a question, a bold
 *    claim, a number, "here's why...") rather than lean on what came before
 *    ("and so, as I said...")?
 *  - a clean start and a clean end: it starts on a fresh sentence and ends on
 *    a finished one, so nothing is cut mid-thought;
 *  - delivery: steady, lively speech rather than dead air or a crawl;
 *  - focus: it keeps returning to the same few words, so it is about one thing;
 *  - the landing: it ends on a strong line rather than a dangling question;
 *  - fit: how close it is to the requested length.
 *
 * Timing, punctuation and repetition work in any language Whisper writes;
 * the word lists (openers, hook phrases, filler) are English, so English
 * transcripts get the sharpest picks.
 *
 * Pure (no browser or Node APIs): runs in the browser and in
 * scripts/verify-clips.mjs.
 */

import { CLIP_LENGTHS, toSuggestions, type ClipLength, type ClipSuggestion, type RawPick, type TranscriptLine } from './lines';

const SENTENCE_END = /[.!?。！？؟।]["'”’)\]]*$/u;
const QUESTION_END = /[?？؟]["'”’)\]]*$/u;
const NUMBER = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion|percent)\b/i;

/** First words that mean the line continues something said before it. */
const WEAK_OPENERS = new Set([
  'so', 'and', 'but', 'or', 'um', 'umm', 'uh', 'uhh', 'er', 'erm', 'like', 'yeah', 'yep', 'okay', 'ok', 'right',
  'because', 'cause', 'which', 'then', 'also', 'well', 'anyway', 'plus', 'mhm', 'hmm',
]);
/** First words that point at something the viewer has not seen. */
const POINTING_OPENERS = new Set(['it', "it's", 'this', 'that', "that's", 'these', 'those', 'he', 'she', 'they', 'him', 'her', 'them', 'there']);
const BACK_REFERENCE =
  /\b(as i (said|mentioned)|like i (said|mentioned)|i (just )?mentioned|we (just )?talked about|(as|like) you said|earlier|going back to|the other thing|same thing)\b/i;
const HOOK_PHRASES =
  /\b(here'?s (the|what|why|how)|the (truth|secret|problem|reason|mistake|key|trick|lesson) (is|was)|nobody (tells|talks|knows)|no one (tells|talks|knows)|what if|imagine|i (learned|realized|discovered|was wrong)|the (number one|biggest|best|worst)|you (need to|have to|should|shouldn'?t|won'?t believe|can'?t)|stop (doing|trying)|let me tell you|true story|unpopular opinion|hot take|the (first|only) (thing|time)|why (do|does|is|are|did|would)|how (to|do you|did you|i))\b/i;
const STRONG_WORDS =
  /\b(never|always|everyone|everybody|nobody|best|worst|biggest|secret|truth|mistake|wrong|crazy|insane|incredible|amazing|terrible|love|hate|millions?|billions?|money|died|fired|quit|failed|success|changed|shocked|important|problem|dangerous|easy|hard|simple)\b/gi;
const FILLER = /\b(um+|uh+|erm|you know|i mean|kind of|sort of)\b/gi;
const STOPWORDS = new Set(
  (
    'the a an and or but so if then than that this these those there here it its it\'s is are was were be been being am do does did done ' +
    'have has had having i me my mine we us our you your yours he him his she her they them their what which who whom whose when where ' +
    'why how all any both each few more most other some such no nor not only own same too very can will just should now with about ' +
    'against between into through during before after above below from up down in out on off over under again further once of at by ' +
    'for to as like yeah okay really know think going get got gonna wanna thing things lot kind sort mean right well also actually ' +
    'would could one two because want say said see way people something anything everything'
  ).split(' '),
);

/** Below this a stretch is not offered, however short the list. */
const QUALITY_FLOOR = 0.5;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const firstWord = (text: string) => (text.trim().split(/\s+/)[0] ?? '').toLowerCase().replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');
const count = (re: RegExp, text: string) => text.match(re)?.length ?? 0;
const words = (text: string) => text.split(/\s+/).filter(Boolean);
/** Content words, for spotting what a stretch is about. */
const contentWords = (text: string) =>
  words(text.toLowerCase())
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));

/** What a line contributes, worked out once. */
type LineInfo = { words: number; spoken: number; strong: number; filler: number; content: string[] };

/** How a stretch opens, which depends only on its first line. */
type Opening = { hook: number; question: boolean; cleanStart: number };

/** How a stretch ends, which depends only on its last line. */
type Ending = { cleanEnd: number; landing: number };

type Scored = {
  a: number;
  b: number;
  score: number;
  opening: Opening;
  ending: Ending;
  pace: number;
  topic: string | null;
  topicCount: number;
};

function lineInfo(line: TranscriptLine): LineInfo {
  return {
    words: words(line.text).length,
    spoken: Math.max(0, line.end - line.start),
    strong: count(STRONG_WORDS, line.text),
    filler: count(FILLER, line.text),
    content: contentWords(line.text),
  };
}

/** The hook (does it grab attention cold?) and whether it starts cleanly. */
function openingOf(lines: TranscriptLine[], a: number): Opening {
  const first = lines[a];
  const second = lines[a + 1];
  // A very short first line ("Look.") is judged together with the next.
  const opening = first.end - first.start < 2.5 && second ? `${first.text} ${second.text}` : first.text;
  const opener = firstWord(first.text);
  const question = /[?？؟]/u.test(opening);
  let hook = 0.35;
  if (HOOK_PHRASES.test(opening)) hook += 0.35;
  if (question) hook += 0.25;
  if (NUMBER.test(opening)) hook += 0.1;
  if (count(STRONG_WORDS, opening) > 0) hook += 0.1;
  if (WEAK_OPENERS.has(opener)) hook -= 0.35;
  else if (POINTING_OPENERS.has(opener)) hook -= 0.2;
  if (BACK_REFERENCE.test(second ? `${first.text} ${second.text}` : first.text)) hook -= 0.4;

  // A clean start: a fresh sentence, or a pause before it.
  const prev = a > 0 ? lines[a - 1] : null;
  const gapBefore = prev ? first.start - prev.end : Infinity;
  const cleanStart = !prev || SENTENCE_END.test(prev.text) || gapBefore >= 0.6 ? 1 : gapBefore >= 0.3 || /[,;:]$/.test(prev.text) ? 0.4 : 0;
  return { hook: clamp01(hook), question, cleanStart };
}

/** Whether it ends on a finished thought, and on a strong line. */
function endingOf(lines: TranscriptLine[], b: number): Ending {
  const last = lines[b];
  const next = b < lines.length - 1 ? lines[b + 1] : null;
  const gapAfter = next ? next.start - last.end : Infinity;
  const cleanEnd = SENTENCE_END.test(last.text) ? (gapAfter >= 0.4 ? 1 : 0.8) : gapAfter >= 0.7 ? 0.45 : 0;
  // The landing: a strong last line, not an unanswered question.
  let landing = 0.5;
  if (count(STRONG_WORDS, last.text) > 0 || /!["'”’)\]]*$/u.test(last.text)) landing += 0.35;
  if (QUESTION_END.test(last.text)) landing -= 0.3;
  if (WEAK_OPENERS.has(firstWord(last.text)) && words(last.text).length <= 3) landing -= 0.2;
  return { cleanEnd, landing: clamp01(landing) };
}

/** The reasons worth showing a creator, strongest first. */
function reasonsFor(c: Scored): string {
  const reasons: string[] = [];
  if (c.opening.hook >= 0.75) reasons.push(c.opening.question ? 'Opens with a question' : 'Strong opening line');
  if (c.opening.cleanStart === 1 && c.ending.cleanEnd >= 0.8) reasons.push('Starts and ends on complete thoughts');
  else if (c.ending.cleanEnd >= 0.8) reasons.push('Ends on a complete thought');
  if (c.topic && c.topicCount >= 3) reasons.push(`Stays on one idea ("${c.topic}")`);
  if (c.ending.landing >= 0.85) reasons.push('Lands on a strong line');
  if (c.pace >= 0.75) reasons.push('Lively, steady delivery');
  return reasons.slice(0, 3).join(' · ') || 'A self-contained stretch of about the right length';
}

/** A short, postable title: the stretch's question or strongest line. */
function titleFor(lines: TranscriptLine[], a: number, b: number): string {
  const span = lines.slice(a, b + 1);
  const pick =
    span.find((l) => QUESTION_END.test(l.text) && words(l.text).length >= 4 && words(l.text).length <= 14) ??
    span.find((l) => HOOK_PHRASES.test(l.text) && words(l.text).length <= 16) ??
    span.find((l) => words(l.text).length >= 4) ??
    span[0];
  let t = pick.text.trim();
  // Drop a leading "so", "and", "um" etc.
  while (WEAK_OPENERS.has(firstWord(t)) && words(t).length > 3) t = t.replace(/^\S+\s+/, '');
  t = t.replace(/[.,;:]+$/u, '');
  if (t.length > 60) t = `${t.slice(0, 57).replace(/\s+\S*$/, '')}…`;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** The opening words, as a viewer first hears them. */
function hookFor(line: TranscriptLine): string {
  const w = words(line.text);
  return w.length > 14 ? `${w.slice(0, 14).join(' ')}…` : line.text;
}

/**
 * The best stand-alone clips in `lines`, best first, as the same suggestions
 * the AI path returns. Runs in well under a second on a two-hour transcript.
 */
export function findClipsLocally(lines: TranscriptLine[], length: ClipLength, maxClips = 6): ClipSuggestion[] {
  if (lines.length < 2) return [];
  const { min, max, hardMin, hardMax } = CLIP_LENGTHS[length];
  const info = lines.map(lineInfo);
  const openings = lines.map((_, i) => openingOf(lines, i));
  const endings = lines.map((_, i) => endingOf(lines, i));

  const scored: Scored[] = [];
  for (let a = 0; a < lines.length; a++) {
    // Running totals as the stretch grows one line at a time.
    let nWords = 0;
    let spoken = 0;
    let strongCount = 0;
    let fillerCount = 0;
    let repeated = 0;
    let topic: string | null = null;
    let topicCount = 1;
    const freq = new Map<string, number>();
    for (let b = a; b < lines.length; b++) {
      const li = info[b];
      nWords += li.words;
      spoken += li.spoken;
      strongCount += li.strong;
      fillerCount += li.filler;
      for (const w of li.content) {
        const c = (freq.get(w) ?? 0) + 1;
        freq.set(w, c);
        repeated += c === 2 ? 2 : c > 2 ? 1 : 0;
        if (c > topicCount) {
          topic = w;
          topicCount = c;
        }
      }
      // toSuggestions pads each clip by 0.5 s; judge the padded length.
      const dur = lines[b].end - lines[a].start + 0.5;
      if (dur > hardMax) break;
      if (dur < hardMin) continue;

      const opening = openings[a];
      const ending = endings[b];
      // Delivery: words per second while speaking, and how much is silence.
      const wps = nWords / Math.max(1, spoken);
      const speechRatio = spoken / Math.max(1, dur);
      const pace = clamp01(1 - Math.abs(wps - 2.8) / 2.2) * clamp01((speechRatio - 0.55) / 0.35);
      // Focus: content words that keep coming back.
      const focus = clamp01((repeated / Math.max(1, nWords)) * 6);
      // Fit: full marks inside the requested range, less towards the limits.
      const fit = clamp01(dur < min ? 0.4 + (0.6 * (dur - hardMin)) / Math.max(1, min - hardMin) : dur > max ? 1 - (0.6 * (dur - max)) / Math.max(1, hardMax - max) : 1);
      // Energy: emphatic words, and the cost of filler.
      const strong = clamp01((strongCount / Math.max(1, nWords)) * 25);
      const filler = clamp01((fillerCount / Math.max(1, nWords)) * 12);

      const score =
        0.27 * opening.hook +
        0.13 * opening.cleanStart +
        0.16 * ending.cleanEnd +
        0.12 * pace +
        0.1 * focus +
        0.08 * ending.landing +
        0.08 * fit +
        0.06 * strong -
        0.15 * filler;
      scored.push({ a, b, score, opening, ending, pace, topic, topicCount });
    }
  }
  if (!scored.length) return [];

  let best = -Infinity;
  let worst = Infinity;
  for (const c of scored) {
    best = Math.max(best, c.score);
    worst = Math.min(worst, c.score);
  }
  // Best first, skipping any that overlap a better one; only the winners get
  // titles. toSuggestions then applies the same checks as the AI path.
  scored.sort((x, y) => y.score - x.score);
  // Fewer picks rather than weak ones: nothing far below this video's best,
  // and nothing that is weak outright.
  const floor = Math.max(QUALITY_FLOOR, best * 0.75);
  const chosen: Scored[] = [];
  for (const c of scored) {
    if (c.score < floor) break;
    if (chosen.some((o) => c.a <= o.b && c.b >= o.a)) continue;
    chosen.push(c);
    if (chosen.length >= maxClips) break;
  }
  const picks: RawPick[] = chosen.map((c) => ({
    first_line: c.a,
    last_line: c.b,
    title: titleFor(lines, c.a, c.b),
    hook: hookFor(lines[c.a]),
    reason: reasonsFor(c),
    // Relative to this video: the best stretch scores 95, the weakest 10.
    score: 10 + (85 * (c.score - worst)) / Math.max(1e-9, best - worst),
  }));
  return toSuggestions(picks, lines, length, maxClips);
}
