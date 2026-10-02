'use client';

/**
 * In-browser render engine (FFmpeg WASM).
 *
 * The source video never leaves the user's device: bytes are read into WASM
 * memory, transcoded, and handed straight back as a Blob for download. That
 * means zero render compute for us, no upload bandwidth, no object storage
 * required for the free tier, and nothing to lose if a third-party host goes
 * down.
 *
 * Trade-off, stated plainly: WASM encoding is much slower than a native
 * server-side ffmpeg, and long clips can exhaust browser memory. Once the
 * Oracle worker exists, `renderEngine: 'worker'` should take precedence for
 * long clips and for the `smart_face` model.
 */

import { loadFFmpegClass, type FFmpegInstance } from './ffmpeg-loader';
import { filterExpr, outputCanvas, type Focus, type Ratio } from './geometry';

/** Core assets are served from /public (see scripts/sync-ffmpeg-core.mjs). */
const CORE_BASE = '/ffmpeg';
const SINGLE_CORE_VERSION = '0.12.10';

export type RenderProgress = {
  /** 0..1 across the whole job, weighted across every requested output. */
  progress: number;
  label: string;
  ratio?: Ratio;
};

export type RenderedOutput = {
  ratio: Ratio;
  width: number;
  height: number;
  blob: Blob;
  filename: string;
  sizeBytes: number;
};

export type RenderResult = {
  outputs: RenderedOutput[];
  /** Wall-clock seconds spent rendering. */
  elapsedSeconds: number;
};

export class RenderAbortedError extends Error {
  constructor() {
    super('Render cancelled');
    this.name = 'RenderAbortedError';
  }
}

let instance: FFmpegInstance | null = null;
let loading: Promise<FFmpegInstance> | null = null;

/**
 * The multi-threaded core needs SharedArrayBuffer, which needs the page to be
 * cross-origin isolated (COOP/COEP headers). When it is not, fall back to the
 * single-threaded core, which works everywhere and only costs speed.
 */
export function prefersMultiThread(): boolean {
  return (
    typeof crossOriginIsolated !== 'undefined' &&
    crossOriginIsolated &&
    typeof SharedArrayBuffer !== 'undefined' &&
    // Very low-core devices do badly with MT; keep them on the ST core.
    (navigator.hardwareConcurrency ?? 1) >= 4
  );
}

/**
 * Load the wasm core into a worker.
 *
 * The wrapper itself is imported at runtime from /public (see ffmpeg-loader.ts)
 * because bundlers rewrite the `await import(coreURL)` inside its worker.
 *
 * Core paths are passed as direct same-origin URLs rather than blob URLs: the
 * worker imports them as ES modules, which works for a served file, and a blob
 * would duplicate the ~32 MB wasm in memory right before we ask the engine to
 * hold a whole video in WASM heap too.
 */
async function loadCore(useMt: boolean): Promise<FFmpegInstance> {
  const FFmpeg = await loadFFmpegClass();
  const ffmpeg = new FFmpeg();
  const base = useMt ? `${CORE_BASE}/mt` : `${CORE_BASE}/${SINGLE_CORE_VERSION}`;
  await ffmpeg.load({
    coreURL: `${base}/ffmpeg-core.js`,
    wasmURL: `${base}/ffmpeg-core.wasm`,
    ...(useMt ? { workerURL: `${base}/ffmpeg-core.worker.js` } : {}),
  });
  return ffmpeg;
}

export async function getFFmpeg(
  onLog?: (line: string) => void,
): Promise<FFmpegInstance> {
  if (instance) return instance;
  if (loading) return loading;

  loading = (async () => {
    if (prefersMultiThread()) {
      try {
        instance = await loadCore(true);
        return instance;
      } catch {
        // Fall through to single-threaded.
      }
    }
    instance = await loadCore(false);
    return instance;
  })();

  try {
    const ffmpeg = await loading;
    if (onLog) ffmpeg.on('log', ({ message }) => onLog(message));
    return ffmpeg;
  } finally {
    loading = null;
  }
}

export function isEngineLoaded(): boolean {
  return instance !== null;
}

/** Release WASM memory (e.g. after leaving the studio). */
export async function disposeEngine(): Promise<void> {
  const current = instance;
  instance = null;
  if (!current) return;
  try {
    current.terminate();
  } catch {
    /* already gone */
  }
}

function extensionFor(name: string): string {
  const ext = /\.([a-z0-9]{2,5})$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  // ffmpeg picks the demuxer from the extension; normalise what we accept.
  if (ext === 'mov' || ext === 'mp4' || ext === 'webm' || ext === 'mkv') return ext;
  return 'mp4';
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60) || 'clip';
}

/**
 * Read the source into WASM memory.
 *
 * We pass raw bytes rather than the blob: URL: @ffmpeg/ffmpeg's dispatcher
 * only understands absolute http(s) paths and otherwise tries to resolve the
 * string as a module, failing with "Cannot find module 'blob:...'".
 *
 * The Uint8Array must be freshly allocated per call - ffmpeg's writeFile
 * transfers (detaches) the buffer, so a reused one throws
 * "ArrayBuffer at index 0 is already detached".
 */
async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/** What the render engine knows about the source, from probe.ts. */
export type SourceInfo = {
  width: number;
  height: number;
  codec?: string;
  h264Profile?: number;
};

const VIDEO_ENCODE = [
  '-c:v',
  'libx264',
  // veryfast is the measured sweet spot for WASM: ultrafast is ~1.5x quicker
  // again but visibly softer on detailed footage.
  '-preset',
  'veryfast',
  '-crf',
  '23',
  '-pix_fmt',
  'yuv420p',
];
// `?` makes the audio map optional, so silent sources still render.
const AUDIO = ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '128k', '-ac', '2'];

/**
 * Transcode one source file into every requested ratio, in a single pass.
 *
 * The source is decoded once and split to one encoder per format; decoding is
 * roughly a quarter of the work on 1080p footage, so separate passes per format
 * paid that cost again for every extra output. Each output is sized to the
 * detail its crop really has (geometry.outputCanvas), and an output that would
 * reproduce an ordinary H.264 source exactly is stream-copied, not re-encoded.
 *
 * Framing uses dimension-free FFmpeg crop expressions (see geometry.filterExpr),
 * so the crop always matches the real decoded frame.
 *
 * `focus` shifts the crop window for every output, in fractions of the source
 * frame. Omit it (or pass the centre) for the default centred framing.
 *
 * `source` is optional: without it every output renders at 1080-class and
 * nothing is copied, which is always correct, just slower.
 */
export async function renderToRatios(
  file: File,
  ratios: Ratio[],
  opts: {
    onProgress?: (p: RenderProgress) => void;
    onLog?: (line: string) => void;
    signal?: AbortSignal;
    focus?: Focus | null;
    source?: SourceInfo | null;
  } = {},
): Promise<RenderResult> {
  if (ratios.length === 0) throw new Error('No output formats requested.');

  opts.onProgress?.({ progress: 0, label: 'Loading render engine…' });
  const ffmpeg = await getFFmpeg(opts.onLog);
  const startedAt = performance.now();

  const srcName = `in-${Date.now()}.${extensionFor(file.name)}`;
  const plan = planRender(ratios, opts.source);
  const formats = ratios.length === 1 ? ratios[0] : `${ratios.length} formats`;

  // Unsubscribe in `finally` so a reused engine instance does not accumulate
  // listeners across renders. Typed callback is required by ffmpeg's `off()`.
  const onProgress = ({ progress }: { progress: number }) => {
    const p = Math.min(1, Math.max(0, progress));
    opts.onProgress?.({ progress: 0.05 + p * 0.95, label: `Rendering ${formats} · ${Math.round(p * 100)}%` });
  };
  ffmpeg.on('progress', onProgress);

  // exec() cannot be interrupted, so cancelling mid-render means tearing the
  // worker down. The next render reloads the core (from the HTTP cache).
  const onAbort = () => void disposeEngine();
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  const outputs: RenderedOutput[] = [];
  try {
    opts.onProgress?.({ progress: 0.02, label: 'Reading video into memory…' });
    await ffmpeg.writeFile(srcName, await readFileBytes(file));
    if (opts.signal?.aborted) throw new RenderAbortedError();
    opts.onProgress?.({ progress: 0.05, label: `Rendering ${formats}…` });

    await ffmpeg.exec(buildArgs(srcName, plan, opts.focus));
    if (opts.signal?.aborted) throw new RenderAbortedError();

    for (const item of plan) {
      const data = (await ffmpeg.readFile(item.outName)) as Uint8Array;
      await ffmpeg.deleteFile(item.outName).catch(() => undefined);
      if (data.byteLength === 0) {
        throw new Error(`Rendering ${item.ratio} produced an empty file.`);
      }
      const blob = new Blob([data as unknown as BlobPart], { type: 'video/mp4' });
      outputs.push({
        ratio: item.ratio,
        width: item.canvas.w,
        height: item.canvas.h,
        blob,
        sizeBytes: blob.size,
        filename: `${baseName(file.name)}_${item.ratio.replace(':', 'x')}.mp4`,
      });
    }
  } catch (e) {
    // A terminated worker rejects with its own error; report it as a cancel.
    if (opts.signal?.aborted) throw new RenderAbortedError();
    throw e;
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
    try {
      ffmpeg.off('progress', onProgress);
    } catch {
      /* engine already torn down */
    }
    try {
      await ffmpeg.deleteFile(srcName);
    } catch {
      /* tab may be unloading */
    }
  }

  return { outputs, elapsedSeconds: (performance.now() - startedAt) / 1000 };
}

type PlannedOutput = {
  ratio: Ratio;
  canvas: { w: number; h: number };
  /** Stream-copy the source video instead of re-encoding it. */
  copy: boolean;
  outName: string;
};

/** Decide size and copy-vs-encode per output. Pure, so the UI can show it. */
export function planRender(ratios: Ratio[], source?: SourceInfo | null): PlannedOutput[] {
  return ratios.map((ratio, i) => {
    const canvas = outputCanvas(ratio, source?.width, source?.height);
    return {
      ratio,
      canvas,
      copy: canStreamCopy(source, canvas),
      outName: `out-${i}-${ratio.replace(':', 'x')}.mp4`,
    };
  });
}

/**
 * True when re-encoding would only reproduce the source: same displayed size
 * as the output canvas (so no crop and no scale, and focus is irrelevant), and
 * an 8-bit H.264 profile every platform accepts as-is.
 */
function canStreamCopy(source: SourceInfo | null | undefined, canvas: { w: number; h: number }): boolean {
  if (!source || source.width !== canvas.w || source.height !== canvas.h) return false;
  if (source.codec !== 'avc1' && source.codec !== 'avc3') return false;
  // Baseline, Main, High. Excludes High 10 / 4:2:2 / 4:4:4, which some
  // platforms and phones reject.
  return source.h264Profile === 66 || source.h264Profile === 77 || source.h264Profile === 100;
}

/** One ffmpeg invocation: decode once, split to every encoded output. */
export function buildArgs(srcName: string, plan: PlannedOutput[], focus?: Focus | null): string[] {
  const encoded = plan.filter((p) => !p.copy);
  const args = ['-i', srcName];

  if (encoded.length > 0) {
    const branches = encoded.map((_, i) => `[s${i}]`).join('');
    const graph = [
      encoded.length > 1 ? `[0:v]split=${encoded.length}${branches}` : null,
      ...encoded.map((p, i) => `${encoded.length > 1 ? `[s${i}]` : '[0:v]'}${filterExpr(p.ratio, focus, p.canvas)}[v${i}]`),
    ].filter(Boolean);
    args.push('-filter_complex', graph.join(';'));
  }

  for (const p of plan) {
    const video = p.copy
      ? ['-map', '0:v:0', '-c:v', 'copy']
      : ['-map', `[v${encoded.indexOf(p)}]`, ...VIDEO_ENCODE];
    args.push(...video, ...AUDIO, '-movflags', '+faststart', p.outName);
  }
  return args;
}
