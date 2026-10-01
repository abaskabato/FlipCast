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
import { filterExpr, OUTPUT_CANVAS, type Ratio } from './geometry';

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

/**
 * Transcode one source file into every requested ratio.
 *
 * Framing uses dimension-free FFmpeg crop expressions (see geometry.filterExpr),
 * so there is no probe step and no chance of cropping against a wrong assumption.
 */
export async function renderToRatios(
  file: File,
  ratios: Ratio[],
  opts: {
    onProgress?: (p: RenderProgress) => void;
    onLog?: (line: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<RenderResult> {
  if (ratios.length === 0) throw new Error('No output formats requested.');

  opts.onProgress?.({ progress: 0, label: 'Loading render engine…' });
  const ffmpeg = await getFFmpeg(opts.onLog);
  const startedAt = performance.now();

  const srcName = `in-${Date.now()}.${extensionFor(file.name)}`;
  const outputs: RenderedOutput[] = [];

  // FFmpeg runs one job at a time; map its 0..1 onto the multi-output total.
  let currentIndex = 0;
  // Unsubscribe in `finally` so a reused engine instance does not accumulate
  // listeners across renders. Typed callback is required by ffmpeg's `off()`.
  const onProgress = ({ progress }: { progress: number }) => {
    const p = Math.min(1, Math.max(0, progress));
    opts.onProgress?.({
      progress: (currentIndex + p) / ratios.length,
      label: `Rendering ${ratios[currentIndex]} · ${Math.round(p * 100)}%`,
      ratio: ratios[currentIndex],
    });
  };
  ffmpeg.on('progress', onProgress);

  try {
    opts.onProgress?.({ progress: 0.02, label: 'Reading video into memory…' });
    await ffmpeg.writeFile(srcName, await readFileBytes(file));

    for (let i = 0; i < ratios.length; i++) {
      if (opts.signal?.aborted) throw new RenderAbortedError();
      currentIndex = i;
      const ratio = ratios[i];
      opts.onProgress?.({ progress: i / ratios.length, label: `Rendering ${ratio}…`, ratio });

      const outName = `out-${i}-${ratio.replace(':', 'x')}.mp4`;

      await ffmpeg.exec([
        '-i',
        srcName,
        '-vf',
        filterExpr(ratio),
        '-c:v',
        'libx264',
        '-preset',
        // A sane speed/quality point for WASM: veryfast keeps turnaround
        // tolerable while staying widely compatible.
        'veryfast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-ac',
        '2',
        '-movflags',
        '+faststart',
        outName,
      ]);

      if (opts.signal?.aborted) throw new RenderAbortedError();

      const data = (await ffmpeg.readFile(outName)) as Uint8Array;
      if (data.byteLength === 0) {
        throw new Error(`Rendering ${ratio} produced an empty file.`);
      }
      const blob = new Blob([data as unknown as BlobPart], { type: 'video/mp4' });
      const canvas = OUTPUT_CANVAS[ratio];
      outputs.push({
        ratio,
        width: canvas.w,
        height: canvas.h,
        blob,
        sizeBytes: blob.size,
        filename: `${baseName(file.name)}_${ratio.replace(':', 'x')}.mp4`,
      });

      // Free WASM memory between outputs; a dual-format job would otherwise
      // hold both renders plus the source at once.
      await ffmpeg.deleteFile(outName);
    }
  } finally {
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