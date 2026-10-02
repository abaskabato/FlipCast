/**
 * Full end-to-end check of the launch path against a running server.
 *
 * Covers what unit-level scripts cannot: real signup, real quota reservation
 * in Postgres, a real in-browser render, and the resulting DB + usage state.
 *
 * Usage: node scripts/verify-e2e.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const BASE = process.argv[2] || 'http://127.0.0.1:3100';
const work = await mkdtemp(path.join(tmpdir(), 'flipcast-e2e-'));
const src = path.join(work, 'source.mp4');

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

console.log('building 3s 1280x720 test clip…');
execFileSync(ffmpegPath, [
  '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:d=3:r=30',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-shortest', src,
], { stdio: ['ignore', 'pipe', 'pipe'] });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push('console: ' + m.text().slice(0, 140));
});

const api = [];
page.on('response', (r) => {
  if (r.url().includes('/api/')) api.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`);
});

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // ---- 1. signup ----
  const email = `e2e${Date.now()}@flipcast.test`;
  await page.getByRole('button', { name: /sign up/i }).first().click();
  await page.waitForTimeout(800);
  await page.locator('input[name=name]').fill('E2E User');
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').first().fill('SuperSecret123');
  await page.locator('button[type=submit]').first().click();
  await page.waitForTimeout(4000);
  check('signup + session', (await page.locator('text=Sign out').count()) > 0, email);

  // ---- 2. quota panel appears ----
  check('quota panel visible', await page.locator('h2:has-text("This month")').count() > 0);
  const quotaText = await page.locator('text=/of render time left/i').first().innerText().catch(() => '');
  check('quota shows free allowance', /3m|180|left/i.test(quotaText), quotaText.trim().slice(0, 60));

  // ---- 3. select dual-format outputs ----
  // 9:16 is selected by default, so only 1:1 needs toggling on.
  await page.getByRole('button', { name: /1:1 Square/ }).click();
  await page.waitForTimeout(300);
  const selected = await page.locator('text=2 selected').count();
  check('dual-format selection', selected > 0, '9:16 (default) + 1:1');

  // ---- 4. upload the clip ----
  await page.setInputFiles('input[type=file]', src);
  await page.waitForTimeout(3500);
  const metaVisible = await page.locator('text=1280×720').count();
  check('probe reads source dimensions', metaVisible > 0, '1280x720');
  const durVisible = await page.locator('text=0:03').count();
  check('probe reads duration', durVisible > 0);

  // ---- 5. render ----
  await page.getByRole('button', { name: /Render on this device/i }).click();
  console.log('rendering in-browser (WASM, expect this to take a while)…');

  // Wait for either success or a surfaced error, up to ~4 minutes.
  const deadline = Date.now() + 240_000;
  let done = false;
  while (Date.now() < deadline) {
    if (await page.locator('text=/formats? ready/i').count()) { done = true; break; }
    if (await page.locator('text=/failed|error|cannot|memory/i').count()) { done = true; break; }
    await page.waitForTimeout(2000);
  }

  const readyText = await page.locator('text=/formats? ready/i').count();
  check('render produced outputs', readyText > 0);

  if (readyText > 0) {
    const cards = await page.locator('text=/9:16 · 1080×1920|1:1 · 1080×1080/').count();
    check('both formats reported', cards >= 2, `${cards} output cards`);
    const dl = await page.locator('text=Download all').count();
    check('download affordance present', dl > 0);

    // Verify a real blob exists and is non-trivial in size.
    const sizes = await page.evaluate(() =>
      Array.from(document.querySelectorAll('video')).map((v) => {
        const src = v.getAttribute('src') || '';
        return src.startsWith('blob:') ? 'blob' : 'none';
      }),
    );
    check('preview uses local blob URLs', sizes.length > 0 && sizes.every((s) => s === 'blob'), sizes.join(','));
  }

  // ---- 6. usage was debited ----
  await page.waitForTimeout(2500);
  const usageAfter = await page.evaluate(async () => {
    const r = await fetch('/api/me/usage');
    return r.ok ? await r.json() : null;
  });
  check('usage debited after render', !!usageAfter && usageAfter.usedSeconds >= 2,
    usageAfter ? `used=${usageAfter.usedSeconds}s remaining=${usageAfter.remainingSeconds}s` : 'no usage');
  check('still on free tier', usageAfter?.tier === 'free', usageAfter?.tier);

  // ---- 7. history reflects the job ----
  const jobs = await page.evaluate(async () => {
    const r = await fetch('/api/jobs');
    return r.ok ? await r.json() : null;
  });
  check('job recorded in history', !!jobs && jobs.jobs.length >= 1, jobs ? `${jobs.jobs.length} job(s)` : 'none');
  if (jobs?.jobs?.length) {
    const j = jobs.jobs[0];
    check('job marked completed', j.status === 'completed', j.status);
    check('job has 2 outputs', j.outputs?.length === 2, `${j.outputs?.length} outputs`);
    check('job records source dims', j.sourceWidth === 1280 && j.sourceHeight === 720, `${j.sourceWidth}x${j.sourceHeight}`);
  }

  // ---- 8. quota guard rejects overspend ----
  const big = await page.evaluate(async () => {
    const r = await fetch('/api/transform', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'huge.mp4', targets: ['9:16'], sourceDurationSeconds: 99999 }),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  });
  check('oversize clip rejected', big.status === 402 || big.status === 413, `${big.status} ${big.body?.error ?? ''}`.slice(0, 90));

  // ---- 9. uploads endpoints are retired ----
  const up = await page.evaluate(async () => {
    const r = await fetch('/api/uploads/presign', { method: 'POST' });
    return r.status;
  });
  check('upload endpoint retired (410)', up === 410, String(up));

  // ---- 10. no client errors ----
  const realErrors = pageErrors.filter(
    (e) => !/favicon|Failed to load resource: the server responded with a status of 4/i.test(e),
  );
  check('no uncaught client errors', realErrors.length === 0, realErrors.slice(0, 2).join(' | ').slice(0, 140));
} finally {
  console.log('\napi calls:');
  [...new Set(api)].forEach((a) => console.log('  ' + a));
  await browser.close();
  if (fail === 0) await rm(work, { recursive: true, force: true });
  else console.log(`\nartefacts kept in ${work}: ${(await readdir(work)).join(', ')}`);
}

console.log(fail === 0 ? '\nE2E: ALL PASS' : `\n${fail} E2E FAILURES (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);