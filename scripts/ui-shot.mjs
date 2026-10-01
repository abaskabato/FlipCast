/**
 * Screenshot the running app at several viewports so the UI can be reviewed as
 * pixels rather than as JSX.
 *
 *   node scripts/ui-shot.mjs [baseUrl]
 *
 * Writes PNGs to /tmp/flipcast-ui/. Requires the app to already be serving.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const base = process.argv[2] || 'http://127.0.0.1:3000';
const out = '/tmp/flipcast-ui';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'tablet', width: 834, height: 1100 },
  { name: 'mobile', width: 390, height: 844 },
];

await mkdir(out, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 160)));
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 160)));

  await page.goto(base, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(700);

  const file = `${out}/${vp.name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  console.log(`${vp.name.padEnd(8)} ${vp.width}x${vp.height} -> ${file}`);

  // Cheap layout smells that a screenshot alone can miss.
  const info = await page.evaluate(() => {
    const de = document.documentElement;
    const overflow = de.scrollWidth > de.clientWidth + 1;
    const offenders = [];
    if (overflow) {
      for (const el of document.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > de.clientWidth + 1) {
          offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(r.right)}`);
          if (offenders.length >= 5) break;
        }
      }
    }
    return { overflow, offenders, height: de.scrollHeight };
  });
  console.log(`         scrollHeight=${info.height} h-overflow=${info.overflow}`);
  for (const o of info.offenders) console.log(`         ! ${o}`);
  if (errors.length) {
    console.log(`         ${errors.length} console error(s):`);
    for (const e of errors.slice(0, 3)) console.log(`         ! ${e}`);
  }

  await page.close();
}

// Pricing page too, since it is a separate layout.
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(`${base}/pricing`, { waitUntil: 'networkidle', timeout: 45000 });
await page.screenshot({ path: `${out}/pricing.png`, fullPage: true });
console.log(`pricing  -> ${out}/pricing.png`);
await page.close();

await browser.close();
console.log(`\ndone -> ${out}`);
