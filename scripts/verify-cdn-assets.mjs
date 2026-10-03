/**
 * Checks that every file the site loads from jsDelivr (src/lib/asset-cdn.ts)
 * is byte-identical to the copy in /public, and that the pinned package
 * versions match what is installed. Run after bumping @ffmpeg/core,
 * onnxruntime-web or @mediapipe/tasks-vision, or after changing anything in
 * public/fonts, public/models or public/demo (then update REPO_ASSETS_COMMIT
 * to a pushed commit that contains the change).
 *
 * Run: npm run verify:cdn
 */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const src = await readFile(path.join(root, 'src/lib/asset-cdn.ts'), 'utf8');
const pick = (re) => re.exec(src)?.[1] ?? (() => { throw new Error(`not found: ${re}`); })();

const versions = {
  '@ffmpeg/core': pick(/ffmpegCore: '([^']+)'/),
  '@ffmpeg/core-mt': pick(/ffmpegCoreMt: '([^']+)'/),
  'onnxruntime-web': pick(/onnxRuntime: '([^']+)'/),
  '@mediapipe/tasks-vision': pick(/mediapipeVision: '([^']+)'/),
};
const commit = pick(/REPO_ASSETS_COMMIT = '([0-9a-f]{40})'/);
const NPM = 'https://cdn.jsdelivr.net/npm';
const REPO = `https://cdn.jsdelivr.net/gh/abaskabato/FlipCast@${commit}/public`;

let failed = 0;
const fail = (msg) => { console.log(`FAIL  ${msg}`); failed++; };

for (const [pkg, want] of Object.entries(versions)) {
  const have = JSON.parse(await readFile(path.join(root, 'node_modules', pkg, 'package.json'), 'utf8')).version;
  if (have === want) console.log(`PASS  ${pkg} ${have} matches the pinned CDN version`);
  else fail(`${pkg}: installed ${have}, asset-cdn.ts pins ${want}`);
}

async function filesIn(dir) {
  const out = [];
  for (const e of await readdir(path.join(root, 'public', dir), { withFileTypes: true, recursive: true })) {
    if (e.isFile()) out.push(path.relative(path.join(root, 'public'), path.join(e.parentPath, e.name)));
  }
  return out;
}

/** [local file under public/, CDN URL] for everything the app loads from the CDN. */
const pairs = [
  ['ffmpeg/0.12.10/ffmpeg-core.wasm', `${NPM}/@ffmpeg/core@${versions['@ffmpeg/core']}/dist/esm/ffmpeg-core.wasm`],
  ['ffmpeg/mt/ffmpeg-core.wasm', `${NPM}/@ffmpeg/core-mt@${versions['@ffmpeg/core-mt']}/dist/esm/ffmpeg-core.wasm`],
  ['ort/ort-wasm-simd-threaded.wasm', `${NPM}/onnxruntime-web@${versions['onnxruntime-web']}/dist/ort-wasm-simd-threaded.wasm`],
  ...['vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.wasm'].map((f) => [
    `mediapipe/${f}`,
    `${NPM}/@mediapipe/tasks-vision@${versions['@mediapipe/tasks-vision']}/wasm/${f}`,
  ]),
  ...(await Promise.all(['fonts', 'models', 'demo'].map(filesIn))).flat().map((f) => [f, `${REPO}/${f}`]),
];

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
for (const [local, url] of pairs) {
  const mine = sha(await readFile(path.join(root, 'public', local)));
  const res = await fetch(url).catch((e) => ({ ok: false, status: e.message }));
  if (!res.ok) { fail(`${local}: CDN answered ${res.status}`); continue; }
  const corp = res.headers.get('cross-origin-resource-policy');
  const theirs = sha(Buffer.from(await res.arrayBuffer()));
  if (theirs !== mine) fail(`${local}: CDN copy differs from public/${local}`);
  else if (corp !== 'cross-origin') fail(`${local}: CDN lacks Cross-Origin-Resource-Policy: cross-origin`);
  else console.log(`PASS  ${local}`);
}

console.log(failed ? `\nCDN: ${failed} FAILED` : `\nCDN: all ${pairs.length} files identical`);
process.exit(failed ? 1 : 0);
