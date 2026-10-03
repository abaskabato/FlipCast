'use client';

/**
 * Loads the @ffmpeg/ffmpeg wrapper at runtime from our own origin.
 *
 * Why not a normal `import { FFmpeg } from '@ffmpeg/ffmpeg'`?
 *
 * The wrapper's worker loads the wasm core with `await import(coreURL)`.
 * Bundlers statically rewrite that into a module lookup, which cannot resolve
 * either a plain public path ("Cannot find module '/ffmpeg/0.12.10/ffmpeg-core.js'")
 * or a blob: URL ("Cannot find module 'blob:...'"). The render fails at runtime
 * with no build-time warning.
 *
 * Serving the wrapper unbundled from /public/ffmpeg/lib and importing it with a
 * runtime-only dynamic import keeps that import dynamic, so it resolves.
 *
 * `eval` is deliberate: it moves the `import()` into a scope the bundler does
 * not rewrite. Without it, webpack turns it back into a static lookup and the
 * bug returns. This is the standard workaround for libraries that dynamically
 * import a runtime-supplied URL.
 */

export type FFmpegLogEvent = { type: string; message: string };
export type FFmpegProgressEvent = { progress: number; time: number };

export type FFmpegInstance = {
  load(config: {
    coreURL: string;
    wasmURL: string;
    workerURL?: string;
  }): Promise<boolean>;
  exec(args: string[], timeout?: number): Promise<number>;
  writeFile(path: string, data: Uint8Array): Promise<boolean>;
  readFile(path: string, encoding?: string): Promise<Uint8Array | string>;
  deleteFile(path: string): Promise<boolean>;
  createDir(path: string): Promise<boolean>;
  terminate(): void;
  on(event: 'log', cb: (data: FFmpegLogEvent) => void): void;
  on(event: 'progress', cb: (data: FFmpegProgressEvent) => void): void;
  off(event: 'log', cb: (data: FFmpegLogEvent) => void): void;
  off(event: 'progress', cb: (data: FFmpegProgressEvent) => void): void;
};

type FFmpegCtor = new () => FFmpegInstance;

let ctorPromise: Promise<FFmpegCtor> | null = null;

/** Import a module by URL without the bundler rewriting the import. */
function runtimeImport(url: string): Promise<unknown> {
  const importer = eval('(u) => import(u)') as (u: string) => Promise<unknown>;
  return importer(url);
}

export async function loadFFmpegClass(): Promise<FFmpegCtor> {
  if (ctorPromise) return ctorPromise;

  ctorPromise = (async () => {
    const mod = (await runtimeImport('/ffmpeg/lib/index.js')) as {
      FFmpeg?: FFmpegCtor;
      default?: FFmpegCtor;
    };
    const Ctor = mod.FFmpeg ?? mod.default;
    if (!Ctor) {
      throw new Error('ffmpeg wrapper did not export an FFmpeg class');
    }
    return Ctor;
  })().catch((e) => {
    ctorPromise = null; // allow retry
    throw e;
  });

  return ctorPromise;
}