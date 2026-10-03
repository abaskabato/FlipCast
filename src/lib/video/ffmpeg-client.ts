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
 * long clips.
 */

import { loadFFmpegClass, type FFmpegInstance } from './ffmpeg-loader';
import { filterExpr, outputCanvas, type Focus, type Ratio } from './geometry';
import { fetchAsset, withCdnFallback } from '../asset-cdn';
import { focusTrackFor, type FocusTrack, type SubjectPath } from './tracking';
import { splitFilter, type SplitSegment } from './layout';
import {
  captionFonts,
  buildAss,
  buildSrt,
  type CaptionStyleId,
  type CaptionWord,
} from '../captions/captions';

/**
 * Core assets are served from /public (see scripts/sync-ffmpeg-core.mjs); the
 * big .wasm binaries load from the CDN first (src/lib/asset-cdn.ts).
 */
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
  /** The transcript, when captions were requested and speech was found. */
  captions: { words: CaptionWord[]; srt: string } | null;
  /** Things the user should know, e.g. "no speech found, rendered without captions". */
  notes: string[];
};

/** Burned-in captions: the style, and how to turn the clip's audio into words. */
export type CaptionRequest = {
  style: CaptionStyleId;
  transcribe: (pcm: Float32Array, onProgress: (fraction: number, label: string) => void) => Promise<CaptionWord[]>;
};

export class RenderAbortedError extends Error {
  constructor() {
    super('Render cancelled');
    this.name = 'RenderAbortedError';
  }
}

let instance: FFmpegInstance | null = null;
let loading: Promise<FFmpegInstance> | null = null;
/** Whether `instance` is the multi-threaded core. */
let instanceIsMt = false;
/** Set after the multi-threaded core fails a render; this tab then stays on ST. */
let mtDisabled = false;

/**
 * The multi-threaded core needs SharedArrayBuffer, which needs the page to be
 * cross-origin isolated (COOP/COEP headers). When it is not, fall back to the
 * single-threaded core, which works everywhere and only costs speed.
 */
export function prefersMultiThread(): boolean {
  return (
    !mtDisabled &&
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
 *
 * Only the .wasm comes from the CDN: the JavaScript stays same-origin because
 * the multi-threaded core starts workers from it.
 */
async function loadCore(useMt: boolean): Promise<FFmpegInstance> {
  const FFmpeg = await loadFFmpegClass();
  const base = useMt ? `${CORE_BASE}/mt` : `${CORE_BASE}/${SINGLE_CORE_VERSION}`;
  return withCdnFallback(useMt ? 'ffmpeg core (multi-threaded)' : 'ffmpeg core', async (url) => {
    const ffmpeg = new FFmpeg();
    try {
      await ffmpeg.load({
        coreURL: `${base}/ffmpeg-core.js`,
        wasmURL: url(`${base}/ffmpeg-core.wasm`),
        ...(useMt ? { workerURL: `${base}/ffmpeg-core.worker.js` } : {}),
      });
    } catch (e) {
      try {
        ffmpeg.terminate();
      } catch {
        /* never started */
      }
      throw e;
    }
    return ffmpeg;
  });
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
        instanceIsMt = true;
        return instance;
      } catch {
        // Fall through to single-threaded.
      }
    }
    instance = await loadCore(false);
    instanceIsMt = false;
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
/** A stretch of the source, in seconds. */
export type Trim = { start: number; end: number };

/** Words inside `trim`, moved onto the trimmed clip's timeline. */
export function wordsInTrim(words: CaptionWord[], trim: Trim | null | undefined): CaptionWord[] {
  if (!trim) return words;
  return words
    .filter((w) => w.end > trim.start && w.start < trim.end)
    .map((w) => ({
      text: w.text,
      start: Math.max(0, w.start - trim.start),
      end: Math.min(trim.end, w.end) - trim.start,
    }));
}

/** Everything renderToRatios accepts. */
export type RenderOptions = {
    onProgress?: (p: RenderProgress) => void;
    onLog?: (line: string) => void;
    signal?: AbortSignal;
    focus?: Focus | null;
    source?: SourceInfo | null;
    /** Subject path from subject-detect.ts; the crop follows it. Needs `source`. */
    track?: SubjectPath | null;
    /** Stretches with two people on camera (layout.ts): 9:16 stacks them there. Needs `source`. */
    split?: SplitSegment[] | null;
    /**
     * Render only this stretch of the source, in seconds. Times in `track`
     * and `split` are relative to `trim.start`, as detectSubject returns them
     * for a range.
     */
    trim?: Trim | null;
    /**
     * A transcript already made for this file (source timeline), e.g. while
     * finding clips. Used for captions instead of transcribing again.
     */
    captionWords?: CaptionWord[] | null;
    captions?: CaptionRequest | null;
};

/**
 * The multi-threaded core crashed or went silent mid-render. Carries the
 * transcript (if one was made) so the retry does not transcribe again.
 */
class EngineCrashError extends Error {
  readonly words: CaptionWord[] | null | undefined;
  constructor(words: CaptionWord[] | null | undefined) {
    super('The render engine stopped responding.');
    this.name = 'EngineCrashError';
    this.words = words;
  }
}

/** No log line from the multi-threaded engine for this long means it has hung. */
const MT_SILENCE_MS = 30_000;

export async function renderToRatios(file: File, ratios: Ratio[], opts: RenderOptions = {}): Promise<RenderResult> {
  try {
    return await renderOnce(file, ratios, opts, undefined);
  } catch (e) {
    if (!(e instanceof EngineCrashError) || opts.signal?.aborted) throw e;
    // The multi-threaded core is fast but fragile; the single-threaded one is
    // slower and dependable. Switch for the rest of this tab and try again.
    console.warn('[render] multi-threaded engine failed; retrying single-threaded');
    mtDisabled = true;
    await disposeEngine();
    opts.onProgress?.({ progress: 0, label: 'Switching to the compatibility engine…' });
    return renderOnce(file, ratios, opts, e.words);
  }
}

/**
 * One attempt. `knownWords` skips transcription on a retry: an array is the
 * transcript, null means the source had no audio, undefined means not yet run.
 */
async function renderOnce(
  file: File,
  ratios: Ratio[],
  opts: RenderOptions,
  knownWords: CaptionWord[] | null | undefined,
): Promise<RenderResult> {
  if (ratios.length === 0) throw new Error('No output formats requested.');

  opts.onProgress?.({ progress: 0, label: 'Loading render engine…' });
  const ffmpeg = await getFFmpeg(opts.onLog);
  const startedAt = performance.now();

  const srcName = `in-${Date.now()}.${extensionFor(file.name)}`;
  // Captions are drawn into the picture and a trim changes the timeline, so
  // either way an output is never a copy.
  const plan = planRender(ratios, opts.source, { forceEncode: Boolean(opts.captions || opts.trim) });
  // A transcript made earlier (source timeline) skips transcription.
  if (knownWords === undefined && opts.captionWords) knownWords = wordsInTrim(opts.captionWords, opts.trim);
  const formats = ratios.length === 1 ? ratios[0] : `${ratios.length} formats`;
  const notes: string[] = [];
  let captions: RenderResult['captions'] = null;

  // With captions, transcription takes the first part of the bar.
  const renderFrom = opts.captions ? 0.45 : 0.05;

  // Unsubscribe in `finally` so a reused engine instance does not accumulate
  // listeners across renders. Typed callback is required by ffmpeg's `off()`.
  // Attached only around the render exec: other execs (audio extraction) must
  // not move the bar.
  const onProgress = ({ progress }: { progress: number }) => {
    const p = Math.min(1, Math.max(0, progress));
    opts.onProgress?.({
      progress: renderFrom + p * (1 - renderFrom),
      label: `Rendering ${formats} · ${Math.round(p * 100)}%`,
    });
  };

  // exec() cannot be interrupted, so cancelling mid-render means tearing the
  // worker down. The next render reloads the core (from the HTTP cache).
  const onAbort = () => void disposeEngine();
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  const outputs: RenderedOutput[] = [];
  try {
    opts.onProgress?.({ progress: 0.02, label: 'Reading video into memory…' });
    await ffmpeg.writeFile(srcName, await readFileBytes(file));
    if (opts.signal?.aborted) throw new RenderAbortedError();

    if (opts.track && opts.source) {
      for (const item of plan) {
        if (!item.copy) item.track = focusTrackFor(opts.track, item.ratio, opts.source.width, opts.source.height);
      }
    }
    if (opts.split?.length && opts.source) {
      for (const item of plan) {
        if (!item.copy && item.ratio === '9:16') {
          item.split = { segments: opts.split, srcW: opts.source.width, srcH: opts.source.height };
        }
      }
    }

    let words: CaptionWord[] | null | undefined = knownWords;
    if (opts.captions) {
      try {
        words ??= await captionWords(
          ffmpeg,
          srcName,
          opts.captions,
          (f, label) => opts.onProgress?.({ progress: 0.05 + f * (renderFrom - 0.05), label }),
          opts.trim,
        );
      } catch (e) {
        if (opts.signal?.aborted) throw new RenderAbortedError();
        // Captions are an extra: a failed model download or transcription
        // must not cost the user the render itself.
        console.warn('[captions] failed:', e);
        notes.push(
          'Captions could not be made this time (the speech model did not load), so the video was rendered without them. Try again in a moment.',
        );
        words = [];
      }
      if (opts.signal?.aborted) throw new RenderAbortedError();
      if (words === null) {
        notes.push('This video has no audio track, so it was rendered without captions.');
      } else if (words.length === 0) {
        if (!notes.length) notes.push('No speech was found, so it was rendered without captions.');
      } else {
        captions = { words, srt: buildSrt(words) };
        try {
          await installCaptionFonts(ffmpeg, words, (label) =>
            opts.onProgress?.({ progress: renderFrom, label }),
          );
        } catch (e) {
          // A missing face costs some glyphs, not the render.
          console.warn('[captions] font failed:', e);
          notes.push('The caption font for this language could not be loaded, so some characters may not show.');
        }
        for (const [i, item] of plan.entries()) {
          const name = `cap-${i}.ass`;
          await ffmpeg.writeFile(name, new TextEncoder().encode(buildAss(words, item.ratio, item.canvas, opts.captions.style)));
          item.subtitles = name;
        }
      }
    }

    opts.onProgress?.({ progress: renderFrom, label: `Rendering ${formats}…` });
    ffmpeg.on('progress', onProgress);
    // The multi-threaded core can crash inside a worker without rejecting, which
    // would leave the bar at 0% for ever. ffmpeg logs every frame, so silence
    // means it has hung: tear it down and let renderToRatios retry.
    const mt = instanceIsMt;
    let lastLog = Date.now();
    let hung = false;
    const heartbeat = () => {
      lastLog = Date.now();
    };
    ffmpeg.on('log', heartbeat);
    const watchdog = mt
      ? window.setInterval(() => {
          if (Date.now() - lastLog > MT_SILENCE_MS) {
            hung = true;
            void disposeEngine();
          }
        }, 2_000)
      : 0;
    try {
      await ffmpeg.exec(buildArgs(srcName, plan, opts.focus, opts.trim));
    } catch (e) {
      if (opts.signal?.aborted) throw new RenderAbortedError();
      if (mt) throw new EngineCrashError(words);
      throw e;
    } finally {
      window.clearInterval(watchdog);
      ffmpeg.off('progress', onProgress);
      ffmpeg.off('log', heartbeat);
    }
    if (hung) throw new EngineCrashError(words);
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
    for (const name of [srcName, ...plan.flatMap((p) => (p.subtitles ? [p.subtitles] : []))]) {
      try {
        await ffmpeg.deleteFile(name);
      } catch {
        /* engine torn down, or tab unloading */
      }
    }
  }

  return { outputs, elapsedSeconds: (performance.now() - startedAt) / 1000, captions, notes };
}

const AUDIO_PCM = 'audio.f32';

/**
 * Input options that read only `trim` from the source. Placed before -i, so
 * ffmpeg seeks to the nearest earlier keyframe and decodes forward to the exact
 * start; output timestamps then begin at 0.
 */
function trimInput(trim: Trim | null | undefined): string[] {
  if (!trim) return [];
  const sec = (n: number) => String(Math.round(n * 1000) / 1000);
  return ['-ss', sec(trim.start), '-t', sec(Math.max(0.1, trim.end - trim.start))];
}

/**
 * Transcribe a whole file on this device without rendering anything: the
 * audio is pulled out with the render engine and handed to `transcribe`.
 * Returns null when the file has no audio track. Used to find clips.
 */
export async function transcribeSource(
  file: File,
  transcribe: CaptionRequest['transcribe'],
  onProgress?: (fraction: number, label: string) => void,
): Promise<CaptionWord[] | null> {
  const ffmpeg = await getFFmpeg();
  const srcName = `tx-${Date.now()}.${extensionFor(file.name)}`;
  await ffmpeg.writeFile(srcName, await readFileBytes(file));
  try {
    return await captionWords(ffmpeg, srcName, { transcribe }, onProgress ?? (() => undefined));
  } finally {
    await ffmpeg.deleteFile(srcName).catch(() => undefined);
  }
}

/**
 * Pull 16 kHz mono float PCM out of the source and hand it to the transcriber.
 * Returns null when the source has no audio stream.
 */
async function captionWords(
  ffmpeg: FFmpegInstance,
  srcName: string,
  request: Pick<CaptionRequest, 'transcribe'>,
  onProgress: (fraction: number, label: string) => void,
  trim?: Trim | null,
): Promise<CaptionWord[] | null> {
  onProgress(0, 'Listening to the audio…');
  const code = await ffmpeg.exec([
    ...trimInput(trim),
    '-i', srcName, '-vn', '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-f', 'f32le', AUDIO_PCM,
  ]);
  let pcm: Float32Array;
  try {
    const bytes = (await ffmpeg.readFile(AUDIO_PCM)) as Uint8Array;
    if (code !== 0 || bytes.byteLength < 4) return null;
    // Copy into a fresh, aligned buffer the worker can take ownership of.
    pcm = new Float32Array(bytes.byteLength >> 2);
    new Uint8Array(pcm.buffer).set(bytes.subarray(0, pcm.byteLength));
  } catch {
    return null;
  } finally {
    await ffmpeg.deleteFile(AUDIO_PCM).catch(() => undefined);
  }
  return request.transcribe(pcm, onProgress);
}

const FONTS_DIR = '/fonts';
/** Faces already written into each engine instance's filesystem. */
const installedFonts = new WeakMap<FFmpegInstance, Set<string>>();

/**
 * Put every face the transcript needs where libass looks
 * (subtitles=...:fontsdir=/fonts). libass does not search subfolders, so all
 * faces go flat into /fonts. Large faces (CJK, several MB) are fetched only
 * when the words need them, and the HTTP cache keeps them for next time.
 */
async function installCaptionFonts(
  ffmpeg: FFmpegInstance,
  words: CaptionWord[],
  onStatus: (label: string) => void,
): Promise<void> {
  const done = installedFonts.get(ffmpeg) ?? new Set<string>();
  installedFonts.set(ffmpeg, done);
  await ffmpeg.createDir(FONTS_DIR).catch(() => undefined);
  for (const font of captionFonts(words)) {
    if (done.has(font.file)) continue;
    if (font.file !== 'Anton-Regular.ttf') onStatus('Getting the caption font for this language…');
    const res = await fetchAsset(`/fonts/${font.file}`);
    if (!res.ok) throw new Error(`Could not load the caption font ${font.family}.`);
    const base = font.file.split('/').pop()!;
    await ffmpeg.writeFile(`${FONTS_DIR}/${base}`, new Uint8Array(await res.arrayBuffer()));
    done.add(font.file);
  }
}

type PlannedOutput = {
  ratio: Ratio;
  canvas: { w: number; h: number };
  /** Stream-copy the source video instead of re-encoding it. */
  copy: boolean;
  outName: string;
  /** Moving crop that follows the subject; overrides `focus` for this output. */
  track?: FocusTrack;
  /** ASS file in the ffmpeg FS to burn in. */
  subtitles?: string;
  /** Stack two people top and bottom instead of cropping one window. */
  split?: { segments: SplitSegment[]; srcW: number; srcH: number };
};

/** Decide size and copy-vs-encode per output. Pure, so the UI can show it. */
export function planRender(
  ratios: Ratio[],
  source?: SourceInfo | null,
  opts: { forceEncode?: boolean } = {},
): PlannedOutput[] {
  return ratios.map((ratio, i) => {
    const canvas = outputCanvas(ratio, source?.width, source?.height);
    return {
      ratio,
      canvas,
      copy: !opts.forceEncode && canStreamCopy(source, canvas),
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

/**
 * Thread counts, set explicitly. The multi-threaded core has a fixed pool of
 * 32 worker threads; left to choose, ffmpeg sizes the decoder, the filters and
 * every x264 encoder from the CPU count, which on an 8-core laptop overruns
 * the pool and crashes the engine at 0%. Two decode threads, two filter
 * threads and up to four per encoder (twelve across all encoders) stays well
 * inside it. The single-threaded core ignores these.
 */
const DECODE_THREADS = 2;
const FILTER_THREADS = 2;
const ENCODE_THREAD_BUDGET = 12;
const MAX_ENCODE_THREADS = 4;

/** One ffmpeg invocation: decode once, split to every encoded output. */
export function buildArgs(srcName: string, plan: PlannedOutput[], focus?: Focus | null, trim?: Trim | null): string[] {
  const encoded = plan.filter((p) => !p.copy);
  const encodeThreads = Math.max(
    1,
    Math.min(MAX_ENCODE_THREADS, Math.floor(ENCODE_THREAD_BUDGET / Math.max(1, encoded.length))),
  );
  const args = ['-threads', String(DECODE_THREADS), ...trimInput(trim), '-i', srcName];

  if (encoded.length > 0) {
    const branches = encoded.map((_, i) => `[s${i}]`).join('');
    const graph = [
      encoded.length > 1 ? `[0:v]split=${encoded.length}${branches}` : null,
      ...encoded.map((p, i) => {
        const input = encoded.length > 1 ? `[s${i}]` : '[0:v]';
        const overlay = p.subtitles ? `subtitles=filename=${p.subtitles}:fontsdir=${FONTS_DIR}` : null;
        if (p.split) {
          // The tracked crop without its final format step: split screen is
          // laid over it, then captions and format are applied once at the end.
          const base = filterExpr(p.ratio, p.track ?? focus, p.canvas).replace(/,format=yuv420p$/, '');
          return splitFilter(p.split.segments, p.split.srcW, p.split.srcH, p.canvas, base, input, `[v${i}]`, `p${i}`, overlay);
        }
        return `${input}${filterExpr(p.ratio, p.track ?? focus, p.canvas, overlay)}[v${i}]`;
      }),
    ].filter(Boolean);
    args.push('-filter_complex_threads', String(FILTER_THREADS), '-filter_complex', graph.join(';'));
  }

  for (const p of plan) {
    const video = p.copy
      ? ['-map', '0:v:0', '-c:v', 'copy']
      : ['-map', `[v${encoded.indexOf(p)}]`, ...VIDEO_ENCODE, '-threads', String(encodeThreads)];
    args.push(...video, ...AUDIO, '-movflags', '+faststart', p.outName);
  }
  return args;
}
