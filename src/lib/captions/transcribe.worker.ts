/// <reference lib="webworker" />

/**
 * On-device speech-to-text for captions (Whisper via transformers.js).
 *
 * Runs in a worker so the page stays responsive. Audio arrives as 16 kHz mono
 * PCM extracted by the render engine; nothing is sent anywhere. The only
 * network traffic is the one-time model download from Hugging Face (about
 * 77 MB for the default model, 249 MB for the accurate one, then cached by the
 * browser). The ONNX runtime's .wasm loads from the CDN when it answers and
 * otherwise from our own origin (public/ort, copied by
 * scripts/sync-ffmpeg-core.mjs); see src/lib/asset-cdn.ts.
 *
 * Long audio is cut into segments of about two minutes at the quietest point
 * near each boundary, so a word is rarely split and the UI gets real progress
 * between segments.
 */

import { env, pipeline } from '@huggingface/transformers';

import { cdnUrl } from '../asset-cdn';

/** Whisper base is quick to fetch and run; small is clearly more accurate, notably outside English. */
const MODELS = {
  fast: 'onnx-community/whisper-base_timestamped',
  accurate: 'onnx-community/whisper-small_timestamped',
} as const;
export type CaptionModel = keyof typeof MODELS;
const SAMPLE_RATE = 16_000;
const SEGMENT_SECONDS = 120;
/** How far either side of a boundary to look for a quiet place to cut. */
const CUT_SEARCH_SECONDS = 4;
/** Segments quieter than this (RMS) are skipped; Whisper invents text in silence. */
const SILENCE_RMS = 0.004;

env.allowLocalModels = false;

const ORT_WASM = '/ort/ort-wasm-simd-threaded.wasm';

/**
 * Point the runtime at its files. The plain SIMD+threads build: smaller than
 * the asyncify one, and all the WASM execution provider needs. ONNX Runtime
 * cannot retry a failed start in the same worker, so the CDN copy is checked
 * first and used only when it answers.
 */
async function configureRuntime(): Promise<void> {
  if (!env.backends.onnx.wasm) return;
  let wasm = ORT_WASM;
  const cdn = cdnUrl(ORT_WASM);
  if (cdn) {
    try {
      const res = await fetch(cdn, { method: 'HEAD' });
      if (res.ok) wasm = cdn;
    } catch {
      /* use this site's copy */
    }
  }
  env.backends.onnx.wasm.wasmPaths = { mjs: '/ort/ort-wasm-simd-threaded.mjs', wasm };
}

export type WorkerRequest = { audio: Float32Array; model?: CaptionModel };

export type WorkerMessage =
  | { type: 'download'; loaded: number; total: number }
  | { type: 'progress'; fraction: number }
  | { type: 'done'; words: { text: string; start: number; end: number }[] }
  | { type: 'error'; message: string };

type Chunk = { text: string; timestamp: [number, number | null] };
type Asr = (
  audio: Float32Array,
  opts: Record<string, unknown>,
) => Promise<{ text: string; chunks?: Chunk[] }>;

const post = (m: WorkerMessage) => (self as unknown as Worker).postMessage(m);

let asrPromise: Promise<Asr> | null = null;

function loadModel(model: CaptionModel): Promise<Asr> {
  // Track bytes per file so the overall download fraction is honest.
  const files = new Map<string, { loaded: number; total: number }>();
  asrPromise ??= configureRuntime().then(() => pipeline('automatic-speech-recognition', MODELS[model], {
    device: 'wasm',
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== 'progress' || !p.file || !p.total) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      post({ type: 'download', loaded, total });
    },
  })) as unknown as Promise<Asr>;
  return asrPromise;
}

function rms(a: Float32Array, from: number, to: number): number {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

/** Segment boundaries (sample indices), each moved to the quietest nearby 50 ms. */
function segmentBounds(audio: Float32Array): number[] {
  const bounds = [0];
  const seg = SEGMENT_SECONDS * SAMPLE_RATE;
  const win = Math.round(0.05 * SAMPLE_RATE);
  const search = CUT_SEARCH_SECONDS * SAMPLE_RATE;
  for (let target = seg; target < audio.length - seg / 4; target += seg) {
    let best = target;
    let bestRms = Infinity;
    for (let i = Math.max(bounds[bounds.length - 1] + win, target - search); i < Math.min(audio.length - win, target + search); i += win) {
      const r = rms(audio, i, i + win);
      if (r < bestRms) {
        bestRms = r;
        best = i;
      }
    }
    bounds.push(best);
  }
  bounds.push(audio.length);
  return bounds;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  try {
    const { audio, model = 'fast' } = e.data;
    const asr = await loadModel(model);
    const bounds = segmentBounds(audio);
    const words: { text: string; start: number; end: number }[] = [];

    for (let i = 0; i < bounds.length - 1; i++) {
      const piece = audio.subarray(bounds[i], bounds[i + 1]);
      const offset = bounds[i] / SAMPLE_RATE;
      if (rms(piece, 0, piece.length) >= SILENCE_RMS) {
        const out = await asr(piece, {
          return_timestamps: 'word',
          chunk_length_s: 30,
          stride_length_s: 5,
        });
        for (const c of out.chunks ?? []) {
          const [s, end] = c.timestamp;
          if (typeof s !== 'number') continue;
          words.push({ text: c.text, start: offset + s, end: offset + (end ?? s + 0.3) });
        }
      }
      post({ type: 'progress', fraction: (i + 1) / (bounds.length - 1) });
    }
    post({ type: 'done', words });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
