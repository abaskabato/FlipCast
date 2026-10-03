/**
 * Clip finding, the parts that need no network: turning a transcript into the
 * numbered lines the model reads, and turning the model's picks back into
 * clean, non-overlapping time ranges.
 *
 * The model only ever refers to line numbers, never timestamps, so it cannot
 * invent a time that is not in the transcript, and every clip starts and ends
 * on a real line boundary.
 *
 * Pure (no browser or Node APIs), shared by the browser, the API route and
 * scripts/verify-clips.mjs.
 */

import type { CaptionWord } from '../captions/captions';

/** One transcript line: what the model reads. */
export type TranscriptLine = { i: number; start: number; end: number; text: string };

/** What the user can ask for. */
export type ClipLength = 'short' | 'medium' | 'long';

/** Target clip length in seconds, and the hard bounds a pick must fall within. */
export const CLIP_LENGTHS: Record<ClipLength, { label: string; min: number; max: number; hardMin: number; hardMax: number }> = {
  short: { label: '15–30 s', min: 15, max: 30, hardMin: 8, hardMax: 45 },
  medium: { label: '30–60 s', min: 30, max: 60, hardMin: 18, hardMax: 85 },
  long: { label: '60–90 s', min: 60, max: 90, hardMin: 40, hardMax: 120 },
};

/** A pick as the model returns it. */
export type RawPick = { first_line: number; last_line: number; title: string; hook: string; reason: string; score: number };

/** A finished suggestion, in seconds. */
export type ClipSuggestion = { start: number; end: number; title: string; hook: string; reason: string; score: number };

const MAX_LINE_WORDS = 22;
const LINE_PAUSE = 0.7;

/**
 * Group words into sentence-sized lines: break on sentence ends, on pauses,
 * and at a length cap so a run-on stretch still gets usable cut points.
 */
export function toLines(words: CaptionWord[]): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  let cur: CaptionWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    const text = cur
      .map((w) => w.text.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+([,.!?;:])/g, '$1');
    if (text) lines.push({ i: lines.length, start: cur[0].start, end: cur[cur.length - 1].end, text });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && (w.start - prev.end > LINE_PAUSE || cur.length >= MAX_LINE_WORDS)) flush();
    cur.push(w);
    if (/[.!?。！？؟।]$/u.test(w.text.trim())) flush();
  }
  flush();
  return lines;
}

/** The transcript as the model sees it: one line per row, number and times first. */
export function renderTranscript(lines: TranscriptLine[]): string {
  const t = (s: number) => {
    const m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
  };
  return lines.map((l) => `[${l.i}] ${t(l.start)}-${t(l.end)} ${l.text}`).join('\n');
}

/**
 * Turn the model's picks into suggestions: clamp line numbers, map them to
 * times, drop picks outside the length bounds or overlapping a better pick,
 * and sort best first.
 */
export function toSuggestions(picks: RawPick[], lines: TranscriptLine[], length: ClipLength, max = 8): ClipSuggestion[] {
  if (!lines.length) return [];
  const { hardMin, hardMax } = CLIP_LENGTHS[length];
  const last = lines.length - 1;
  const out: ClipSuggestion[] = [];
  for (const p of [...picks].sort((a, b) => b.score - a.score)) {
    if (!Number.isFinite(p.first_line) || !Number.isFinite(p.last_line)) continue;
    const a = Math.max(0, Math.min(last, Math.round(Math.min(p.first_line, p.last_line))));
    const b = Math.max(0, Math.min(last, Math.round(Math.max(p.first_line, p.last_line))));
    // A little air either side so the first and last words are not clipped.
    const start = Math.max(0, lines[a].start - 0.15);
    const end = lines[b].end + 0.35;
    const len = end - start;
    if (len < hardMin || len > hardMax) continue;
    if (out.some((c) => start < c.end && end > c.start)) continue;
    out.push({
      start,
      end,
      title: p.title.trim().slice(0, 80) || 'Untitled clip',
      hook: p.hook.trim().slice(0, 200),
      reason: p.reason.trim().slice(0, 300),
      score: Math.max(1, Math.min(100, Math.round(p.score))),
    });
    if (out.length >= max) break;
  }
  return out;
}
