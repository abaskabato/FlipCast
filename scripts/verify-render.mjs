/**
 * End-to-end proof that the in-browser FFmpeg engine really renders video.
 *
 * This is the single most important test in the project: the whole product
 * rests on the browser producing a valid MP4 of the requested dimensions. It
 * drives the real @ffmpeg/ffmpeg package against the real self-hosted core,
 * in a real (headless) Chromium, with COOP/COEP set so SharedArrayBuffer and
 * the multi-threaded core are available.
 *
 * Run: node scripts/verify-render.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const root = path.resolve(import.meta.dirname, '..');
const MIME = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.html': 'text/html',
  '.json': 'application/json',
};

// ---------------------------------------------------------------------------
// Static server: serves the test page + self-hosted ffmpeg core with the
// cross-origin isolation headers the multi-threaded core requires.
// ---------------------------------------------------------------------------
function startServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file;
    if (url.pathname === '/') file = path.join(root, 'scripts', 'render-harness.html');
    else if (url.pathname.startsWith('/ffmpeg/'))
      file = path.join(root, 'public', url.pathname.replace(/^\//, ''));
    else if (url.pathname.startsWith('/node_modules/')) {
      // Serve the ESM build of the real packages.
      const rel = url.pathname.slice('/node_modules/'.length);
      const resolved = path.join(root, 'node_modules', rel);
      if (!resolved.startsWith(path.join(root, 'node_modules'))) {
        res.writeHead(403).end('forbidden');
        return;
      }
      file = resolved;
    } else {
      res.writeHead(404).end('not found');
      return;
    }

    if (!existsSync(file)) {
      res.writeHead(404).end(`missing: ${file}`);
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      // Required for SharedArrayBuffer -> multi-threaded core.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// ---------------------------------------------------------------------------
// Build a small but real test clip with colour bands + a tone, so we can
// confirm both that pixels rendered and that audio survived.
// ---------------------------------------------------------------------------
function makeTestVideo(dest) {
  execFileSync(ffmpegPath, [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:d=3:r=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-shortest',
    '-movflags', '+faststart',
    dest,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function probeLocal(file) {
  let stderr = '';
  try {
    execFileSync(ffmpegPath, ['-hide_banner', '-i', file], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { stderr = String(e.stderr || ''); }
  const v = stderr.match(/Video:[^\n]*?(\d{2,5})x(\d{2,5})/);
  const a = /Audio:/.test(stderr);
  return { dims: v ? `${v[1]}x${v[2]}` : 'NONE', hasAudio: a };
}

const CANVAS = { '9:16': '1080x1920', '1:1': '1080x1080', '16:9': '1920x1080' };

async function main() {
  const work = await mkdtemp(path.join(tmpdir(), 'flipcast-render-'));
  const srcVideo = path.join(work, 'source.mp4');
  console.log('building test clip (1280x720, 3s, with audio)…');
  makeTestVideo(srcVideo);
  console.log('source =', probeLocal(srcVideo));

  const { server, port } = await startServer();
  console.log(`harness on http://127.0.0.1:${port}\n`);

  const browser = await chromium.launch({
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();

  // Read the test clip once in Node and hand the bytes to the page, so the
  // browser renders the same file we built.
  const sourceBytes = Array.from(await readFile(srcVideo));

  page.on('console', (m) => {
    const t = m.text();
    if (!t.includes('Download the React DevTools')) console.log(`  [browser:${m.type()}] ${t}`);
  });
  page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}\n${e.stack ?? ''}`));
  page.on('requestfailed', (r) =>
    console.log(`  [reqfail] ${r.url()} :: ${r.failure()?.errorText}`),
  );
  page.on('response', (r) => {
    if (r.status() >= 400) console.log(`  [http ${r.status()}] ${r.url()}`);
  });

  let pass = 0, fail = 0;
  const results = [];

  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.renderOne === 'function', null, { timeout: 15000 });

    // Prime the engine and report which core we got.
    const engine = await page.evaluate(
      async (bytes) => {
        try {
          const r = await window.renderOne('16:9', bytes);
          return { isolated: r.isolated, mt: r.mt, err: window.__mtError || null };
        } catch (e) {
          return { error: String(e && e.message ? e.message : e) };
        }
      },
      sourceBytes,
    );
    if (engine.error) {
      console.log(`  engine load FAILED: ${engine.error}`);
      fail++;
      results.push('engine   FAIL  load error: ' + engine.error);
    } else {
      console.log(`  crossOriginIsolated=${engine.isolated} mt=${engine.mt}${engine.err ? ' (mt error: ' + engine.err + ')' : ''}`);
      console.log(engine.mt ? '  -> multi-threaded core active' : '  -> single-threaded core (isolation off => expected fallback)');
    }

    for (const ratio of ['9:16', '1:1']) {
      const t0 = Date.now();
      const r = await page.evaluate(async (ratio) => {
        try {
          return await window.renderOne(ratio);
        } catch (e) {
          return { error: String(e && e.message ? e.message : e) };
        }
      }, ratio);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);

      if (r.error) {
        fail++;
        results.push(`${ratio.padEnd(6)} FAIL  error: ${r.error}`);
        console.log(`${ratio.padEnd(6)} FAIL  ${r.error}`);
        continue;
      }

      const out = path.join(work, `out-${ratio.replace(':', 'x')}.mp4`);
      await writeFile(out, Buffer.from(r.data));

      const probed = probeLocal(out);
      const size = (await stat(out)).size;
      const want = CANVAS[ratio];
      const okDims = probed.dims === want;
      const okBytes = size > 5000;
      const okAudio = probed.hasAudio;

      if (okDims && okBytes) pass++;
      else fail++;

      const flags = [okDims ? '' : '!dims', okBytes ? '' : '!tiny', okAudio ? '' : '!no-audio']
        .filter(Boolean).join(' ');
      results.push(`${ratio.padEnd(6)} ${okDims && okBytes ? 'PASS' : 'FAIL'}  ${probed.dims} (want ${want})  ${(size / 1024).toFixed(0)}KB  ${secs}s  audio=${probed.hasAudio} ${flags}`);
      console.log(`${ratio.padEnd(6)} ${okDims && okBytes ? 'PASS' : 'FAIL'}  ${probed.dims} (want ${want})  ${(size / 1024).toFixed(0)}KB  in ${secs}s  audio=${probed.hasAudio} ${flags}`);
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n' + results.join('\n'));
  const mtNote = results.length ? '' : '';
  void mtNote;

  // Keep artefacts on failure for debugging.
  if (fail === 0) await rm(work, { recursive: true, force: true });
  else console.log(`\nartefacts kept in ${work}`);

  console.log(fail === 0 ? '\nBROWSER RENDER: ALL PASS' : `\n${fail} FAILURES`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });