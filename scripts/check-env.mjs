/**
 * Preflight check for required environment variables.
 *
 * Run before deploying, or as a Vercel "Build" step, so a missing secret fails
 * with an actionable message instead of a 500 on the first sign-up attempt.
 *
 *   node scripts/check-env.mjs
 *
 * Exits non-zero when a required variable is missing or invalid.
 */

const PROD = process.env.VERCEL || process.env.NODE_ENV === 'production';

const checks = [];

/** @param {string} name @param {boolean} required */
function check(name, required, validate) {
  const raw = process.env[name];
  const value = raw?.trim() ?? '';
  let ok = value.length > 0;
  let detail = value ? 'set' : 'MISSING';

  if (ok && validate) {
    const result = validate(value);
    if (result !== true) {
      ok = false;
      detail = result;
    }
  }

  checks.push({ name, ok, detail, required });
}

// Better Auth's signing secret. A short or absent one lets anyone forge a
// session cookie, so src/lib/auth.ts refuses to start in production.
// Not required in dev: the auth instance has an explicit dev-only fallback.
check('BETTER_AUTH_SECRET', PROD, (v) =>
  v.length >= 32 ? true : `too short (${v.length} chars, need 32+) - openssl rand -base64 32`,
);

// Database. Only required in production; local dev falls back to Docker.
check('DATABASE_URL', PROD, (v) =>
  /^postgres(ql)?:\/\//.test(v) ? true : 'does not look like a postgres:// URL',
);

// Pooled endpoint is strongly preferred on serverless: a direct connection
// exhausts the Postgres connection limit under concurrent requests.
const hasDb = !!process.env.DATABASE_URL?.trim();
const hasPooled = !!process.env.DATABASE_URL_POOLED?.trim();
if (PROD && hasDb && !hasPooled) {
  checks.push({
    name: 'DATABASE_URL_POOLED',
    ok: true,
    detail: 'not set (recommended: use the pooled endpoint to avoid connection exhaustion)',
    required: false,
  });
}

// Canonical URL, used for password-reset links and as the primary trusted origin.
check('BETTER_AUTH_URL', PROD, (v) =>
  /^https?:\/\//.test(v) ? true : 'must be an absolute http(s) URL',
);

let failed = false;
console.log(`\nflipcast env preflight${PROD ? ' (production)' : ''}\n`);

for (const c of checks) {
  const mark = c.ok ? 'ok  ' : c.required ? 'FAIL' : 'warn';
  if (!c.ok && c.required) failed = true;
  console.log(`  ${mark}  ${c.name.padEnd(22)} ${c.detail}`);
}

console.log('');

if (failed) {
  console.error('Required environment variables are missing or invalid.');
  console.error('See .env.example. Never commit real secrets.');
  process.exit(1);
}

console.log('All required variables are present.\n');