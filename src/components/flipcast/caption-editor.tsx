'use client';

import { useMemo, useState } from 'react';

import type { CaptionWord } from '@/lib/captions/captions';
import { editableLines, replaceLine } from '@/lib/captions/edit';

/** "m:ss" for a time in seconds. */
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * The transcript as editable lines, so a wrong name or word can be fixed
 * before captions are burned in. A line is saved when the field loses focus
 * or on Enter; clearing it removes those captions. Times shown are positions
 * in the source video.
 */
export function CaptionEditor({
  words,
  range,
  disabled,
  onChange,
}: {
  words: CaptionWord[];
  /** Only lines inside this stretch are shown (the chosen clip), if set. */
  range: { start: number; end: number } | null;
  disabled?: boolean;
  onChange: (words: CaptionWord[]) => void;
}) {
  const lines = useMemo(() => editableLines(words, range), [words, range]);
  // Text being typed, by the line's first word index; cleared once saved.
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const save = (from: number) => {
    const line = lines.find((l) => l.from === from);
    const draft = drafts[from];
    setDrafts((d) => {
      const next = { ...d };
      delete next[from];
      return next;
    });
    if (!line || draft === undefined || draft.trim() === line.text) return;
    onChange(replaceLine(words, line.from, line.to, draft));
  };

  if (!lines.length) return <p className="fc-meta">No speech in this stretch.</p>;
  return (
    <ol className="max-h-80 space-y-1.5 overflow-y-auto pr-1" aria-label="Caption lines">
      {lines.map((l) => (
        <li key={`${l.from}-${l.start}`} className="flex items-center gap-2">
          <span className="fc-meta w-10 shrink-0 text-right font-mono">{clock(l.start)}</span>
          <input
            value={drafts[l.from] ?? l.text}
            onChange={(e) => setDrafts((d) => ({ ...d, [l.from]: e.target.value }))}
            onBlur={() => save(l.from)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                setDrafts((d) => {
                  const next = { ...d };
                  delete next[l.from];
                  return next;
                });
              }
            }}
            disabled={disabled}
            aria-label={`Caption at ${clock(l.start)}`}
            className="min-h-[36px] w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-zinc-100 outline-none transition-colors focus:border-pink-400/60 focus:bg-white/[0.06] disabled:opacity-50"
          />
        </li>
      ))}
    </ol>
  );
}
