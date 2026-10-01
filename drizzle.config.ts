import type { Config } from 'drizzle-kit';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * drizzle-kit runs outside Next.js, so nothing has loaded .env.local by the
 * time this file is evaluated. Without this, `process.env.DATABASE_URL` is
 * undefined on a fresh shell and `npm run db:migrate` silently falls back to
 * localhost and reports success -- migrations appear to run while never
 * touching the target database.
 *
 * Precedence matches Next.js: real environment > .env.local > .env.
 */
function loadEnvFiles() {
  const preexisting = new Set(Object.keys(process.env));

  for (const file of ['.env', '.env.local']) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    // Node's loader does not overwrite existing keys, so restore the real
    // environment afterwards to keep the documented precedence.
    const before = { ...process.env };
    process.loadEnvFile(path);
    for (const [key, value] of Object.entries(process.env)) {
      if (preexisting.has(key)) process.env[key] = before[key];
    }
  }
}

loadEnvFiles();

const LOCAL_FALLBACK = 'postgresql://postgres:postgres@localhost:5432/flipcast';
const url = process.env.DATABASE_URL?.trim() || LOCAL_FALLBACK;

// Print the target host so a wrong database is obvious in CI logs. Never the
// password.
let target: string;
try {
  target = new URL(url).host;
} catch {
  target = '(unparseable URL)';
}

if (!process.env.DATABASE_URL?.trim()) {
  console.warn(
    `\n[drizzle] DATABASE_URL is not set - falling back to ${target}.\n` +
      `[drizzle] This is usually NOT what you want outside local dev.\n`,
  );
} else {
  console.log(`[drizzle] target database host: ${target}`);
}

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url,
  },
} satisfies Config;
