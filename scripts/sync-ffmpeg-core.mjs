/**
 * Copies the FFmpeg WASM core into /public/ffmpeg so the browser can load it
 * from our own origin.
 *
 * Why not a CDN: the single-threaded core is ~32MB and the multi-threaded core
 * ~33MB. Serving them ourselves means no third party in the critical path, no
 * user-IP leak to a CDN, and no surprise outage taking the renderer down.
 * COEP additionally requires our own assets (a CDN would need CORP headers).
 *
 * The binaries are copied at install time rather than committed, because they
 * are large and versioned by package.json.
 *
 * Run: node scripts/sync-ffmpeg-core.mjs
 */
import { cp, mkdir, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const outRoot = path.join(root, 'public', 'ffmpeg');

const SINGLE_VERSION = '0.12.10';

/** name in node_modules -> destination subdirectory under public/ffmpeg */
const TARGETS = [
  { pkg: '@ffmpeg/core', dir: SINGLE_VERSION },
  { pkg: '@ffmpeg/core-mt', dir: 'mt' },
];

/**
 * The @ffmpeg/ffmpeg wrapper is also copied to public/ffmpeg/lib.
 *
 * Reason: its worker loads the wasm core with `await import(coreURL)`, and
 * webpack statically rewrites that into a module lookup. Neither a plain path
 * nor a blob: URL then resolves ("Cannot find module ..."). Serving the wrapper
 * as a static file and importing it at runtime keeps that import dynamic.
 */
const LIB_TARGETS = [
  { pkg: '@ffmpeg/ffmpeg', dir: 'lib' },
  { pkg: '@ffmpeg/util', dir: 'lib-util' },
];

/**
 * These packages declare an "exports" map that does not include
 * "./package.json", so require.resolve(pkg + '/package.json') is blocked.
 * Resolve the published entry point instead and walk up to dist/esm.
 *
 * ESM (not UMD) is required: @ffmpeg/ffmpeg spawns its core worker with
 * { type: "module" }, where importScripts() is unavailable. The worker falls
 * back to `await import(coreURL)` and reads `.default`; the UMD build has no
 * ESM export, so it fails with "failed to import ffmpeg-core.js".
 */
function resolveEsmDir(pkg) {
  // Some packages ship a nested dist/esm layout, some dist/esm/index.js.
  for (const spec of [pkg, `${pkg}/package.json`]) {
    try {
      const entry = require.resolve(spec, { paths: [root] });
      const idx = entry.lastIndexOf(`${path.sep}dist${path.sep}`);
      if (idx !== -1) return path.join(entry.slice(0, idx), 'dist', 'esm');
    } catch {
      /* try next */
    }
  }
  // package.json is not always exported; fall back to node_modules path.
  const guess = path.join(root, 'node_modules', pkg, 'dist', 'esm');
  return existsSync(guess) ? guess : null;
}

async function main() {
  await mkdir(outRoot, { recursive: true });

  for (const { pkg, dir } of TARGETS) {
    let from;
    try {
      from = resolveEsmDir(pkg);
    } catch {
      from = null;
    }
    if (!from || !existsSync(from)) {
      console.warn(`- ${pkg} not installed or has no dist/esm, skipping (optional)`);
      continue;
    }

    const to = path.join(outRoot, dir);
    await mkdir(to, { recursive: true });
    await cp(from, to, { recursive: true });

    const files = [
      'ffmpeg-core.js',
      'ffmpeg-core.wasm',
      ...(dir === 'mt' ? ['ffmpeg-core.worker.js'] : []),
    ];
    for (const f of files) {
      const p = path.join(to, f);
      if (!existsSync(p)) {
        throw new Error(`expected core file missing: ${p}`);
      }
      const s = await stat(p);
      console.log(`+ public/ffmpeg/${dir}/${f} (${(s.size / 1024 / 1024).toFixed(1)} MB)`);
    }
  }

  // The JS wrapper + helpers, served unbundled so their internal dynamic
  // imports of the core stay dynamic.
  for (const { pkg, dir } of LIB_TARGETS) {
    const from = resolveEsmDir(pkg);
    if (!from || !existsSync(from)) {
      console.warn(`- ${pkg} not installed or has no dist/esm, skipping (optional)`);
      continue;
    }
    const to = path.join(outRoot, dir);
    await mkdir(to, { recursive: true });
    await cp(from, to, { recursive: true });
    const n = (await readdir(from)).length;
    console.log(`+ public/ffmpeg/${dir}/ (${n} files from ${pkg})`);
  }

  console.log('ffmpeg core assets ready');

  // Subject tracking and captions run their own WASM runtimes. Served from our
  // origin for the same reasons as the ffmpeg core: COEP, no CDN in the
  // critical path, and no user IP sent to a third party.
  for (const { from, to, files } of ML_RUNTIMES) {
    const src = path.join(root, 'node_modules', from);
    if (!existsSync(src)) {
      console.warn(`- ${from} not installed, skipping (optional)`);
      continue;
    }
    const dest = path.join(root, 'public', to);
    await mkdir(dest, { recursive: true });
    for (const f of files) {
      await cp(path.join(src, f), path.join(dest, f));
      const s = await stat(path.join(dest, f));
      console.log(`+ public/${to}/${f} (${(s.size / 1024 / 1024).toFixed(1)} MB)`);
    }
  }
}

/**
 * MediaPipe vision (face detection, src/lib/video/subject-detect.ts) and the
 * ONNX runtime transformers.js uses for Whisper (src/lib/captions/). Only the
 * variants the app selects are copied: SIMD and non-SIMD MediaPipe, and the
 * plain SIMD+threads ONNX build (transcribe.worker.ts pins it).
 */
const ML_RUNTIMES = [
  {
    from: '@mediapipe/tasks-vision/wasm',
    to: 'mediapipe',
    files: [
      'vision_wasm_internal.js',
      'vision_wasm_internal.wasm',
      'vision_wasm_nosimd_internal.js',
      'vision_wasm_nosimd_internal.wasm',
    ],
  },
  {
    from: 'onnxruntime-web/dist',
    to: 'ort',
    files: [
      'ort-wasm-simd-threaded.mjs',
      'ort-wasm-simd-threaded.wasm',
    ],
  },
];

main().catch((e) => {
  console.error(e);
  process.exit(1);
});