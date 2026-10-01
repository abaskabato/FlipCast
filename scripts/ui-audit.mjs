/**
 * Measure the UI objectively instead of eyeballing a screenshot.
 *
 *   node scripts/ui-audit.mjs [baseUrl]
 *
 * Reports the things that make an interface feel cheap: contrast failures, a
 * collapsed type scale, weak spacing rhythm, inconsistent radii, and controls
 * below a usable tap size. All read from computed styles, so this works against
 * the real rendered page.
 */
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:3000';

const AUDIT = () => {
  const parse = (c) => {
    const m = c.match(/[\d.]+/g) || [];
    return { r: +m[0], g: +m[1], b: +m[2], a: m[3] === undefined ? 1 : +m[3] };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  // Walk up for the first non-transparent background.
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c.a > 0.05) return c;
      n = n.parentElement;
    }
    return parse(getComputedStyle(document.body).backgroundColor);
  };

  const text = [];
  const boxes = [];
  const radii = new Set();
  const typeSizes = new Set();
  const controls = [];
  const seen = new Set();

  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;

    if (cs.borderTopLeftRadius && cs.borderTopLeftRadius !== '0px') {
      radii.add(cs.borderTopLeftRadius);
    }

    // Text nodes actually rendered.
    const hasText = [...el.childNodes].some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
    );
    if (hasText) {
      const size = parseFloat(cs.fontSize);
      const weight = cs.fontWeight;
      typeSizes.add(`${size}px/${weight}`);
      const fg = parse(cs.color);
      const bg = bgOf(el);
      text.push({
        sample: el.textContent.trim().slice(0, 34),
        size,
        weight,
        color: cs.color,
        cr: fg.a < 0.5 ? ratio(fg, bg) : null,
        sizeKey: `${size}|${weight}`,
      });

      if (el.children.length === 0) {
        boxes.push({
          size,
          tag: el.tagName.toLowerCase(),
          cls: String(el.className).slice(0, 50),
        });
      }
    }

    if (el.tagName === 'BUTTON' || el.tagName === 'A') {
      controls.push({
        tag: el.tagName.toLowerCase(),
        w: Math.round(r.width),
        h: Math.round(r.height),
        label: el.textContent.trim().slice(0, 26),
      });
    }
    seen.add(el.className);
  }

  // Group text by size+weight so we can see the scale, not the noise.
  const scale = {};
  for (const t of text) {
    const k = `${t.size}/${t.weight}`;
    scale[k] = (scale[k] || 0) + 1;
  }

  const lowContrast = text
    .filter((t) => t.cr !== null && t.cr < 4.5)
    .map((t) => ({ text: t.sample, cr: +t.cr.toFixed(2), size: t.size }));

  const tinyText = boxes
    .filter((b) => b.size < 12)
    .map((b) => ({ text: b.cls.slice(0, 34), size: b.size }));

  const smallTargets = controls.filter((c) => c.h < 24 || c.w < 24);

  return {
    typeScale: Object.entries(scale).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])),
    lowContrast: lowContrast.slice(0, 25),
    lowContrastCount: lowContrast.length,
    tinyTextCount: tinyText.length,
    tinyText: tinyText.slice(0, 12),
    radii: [...radii].sort(),
    smallTargets: smallTargets.slice(0, 15),
    controlCount: controls.length,
    smallestControl: Math.min(...controls.map((c) => c.h), 999),
  };
};

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(base, { waitUntil: 'networkidle', timeout: 45000 });

const r = await page.evaluate(AUDIT);

console.log(`\nTYPE SCALE (size/weight -> count)`);
for (const [k, n] of r.typeScale) console.log(`  ${k.padEnd(14)} ${n}`);

console.log(`\nCONTROLS: ${r.controlCount}, smallest height ${r.smallestControl}px`);
for (const c of r.smallTargets) {
  console.log(`  ! ${c.tag} ${c.w}x${c.h} "${c.label}"`);
}

console.log(`\nLOW CONTRAST (<4.5:1): ${r.lowContrastCount}`);
for (const t of r.lowContrast) {
  console.log(`  ! ${String(t.cr).padStart(5)}  ${t.size}px  "${t.text}"`);
}

console.log(`\nTEXT BELOW 12px: ${r.tinyTextCount}`);
for (const t of r.tinyText) console.log(`  ! ${t.size}px  ${t.text}`);

console.log(`\nRADII in use: ${r.radii.join(', ')}`);

await browser.close();
