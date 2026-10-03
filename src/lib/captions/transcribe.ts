'use client';

import type { CaptionWord } from './captions';
import type { WorkerMessage } from './transcribe.worker';

export type TranscribeProgress =
  | { stage: 'download'; fraction: number; loadedBytes: number; totalBytes: number }
  | { stage: 'transcribe'; fraction: number };

/**
 * Transcribe 16 kHz mono PCM into timed words, on this device.
 *
 * Spawns a fresh worker per call and terminates it afterwards, which returns
 * the model's memory (a few hundred MB) before the render engine needs it.
 */
export function transcribe(
  audio: Float32Array,
  opts: { signal?: AbortSignal; onProgress?: (p: TranscribeProgress) => void } = {},
): Promise<CaptionWord[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => {
      worker.terminate();
      opts.signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      finish();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.type === 'download') {
        opts.onProgress?.({
          stage: 'download',
          fraction: m.total ? m.loaded / m.total : 0,
          loadedBytes: m.loaded,
          totalBytes: m.total,
        });
      } else if (m.type === 'progress') {
        opts.onProgress?.({ stage: 'transcribe', fraction: m.fraction });
      } else if (m.type === 'done') {
        finish();
        resolve(m.words);
      } else {
        finish();
        reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message || 'The transcription worker failed to start.'));
    };
    // Transfer, not copy: the PCM for a long clip is tens of megabytes.
    worker.postMessage({ audio }, [audio.buffer]);
  });
}
