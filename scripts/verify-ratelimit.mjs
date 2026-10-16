/**
 * Verifies the shared rate limiter (src/lib/rate-limit.ts) against a local
 * Postgres:
 *
 *  - two separate processes (like two server instances) firing at once
 *    together allow exactly the limit, no more;
 *  - the count resets once the window has passed;
 *  - with the database unreachable it allows requests (fails open).
 *
 * Needs a throwaway database, never production:
 *   RATELIMIT_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/flipcast_test npm run verify:ratelimit
 */
import { spawn } from 'node:child_process';

const dbUrl = process.env.RATELIMIT_TEST_DATABASE_URL;
if (!dbUrl || !['127.0.0.1', 'localhost'].includes(new URL(dbUrl).hostname)) {
  console.error('Refusing to run: RATELIMIT_TEST_DATABASE_URL must point at a local throwaway database.');
  process.exit(2);
}

let failed = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
};

// One "instance": a fresh process with its own module state and pool.
const instance = (key, calls, limit, windowMs, url = dbUrl) =>
  new Promise((resolve, reject) => {
    const code = `
      const { checkRateLimit } = await import('${new URL('../src/lib/rate-limit.ts', import.meta.url).pathname}');
      const { pool } = await import('${new URL('../src/db/index.ts', import.meta.url).pathname}');
      const r = await Promise.all(Array.from({ length: ${calls} }, () => checkRateLimit(${JSON.stringify(key)}, ${limit}, ${windowMs})));
      console.log(JSON.stringify(r.filter(Boolean).length));
      await pool.end();`;
    const child = spawn(process.execPath, ['--import', new URL('./ts-register.mjs', import.meta.url).pathname, '--input-type=module', '-e', code], {
      env: { ...process.env, DATABASE_URL: url, DATABASE_URL_POOLED: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', () => undefined);
    child.on('close', (c) => (c === 0 ? resolve(Number(out.trim().split('\n').pop())) : reject(new Error(`exit ${c}`))));
  });

const key = `test-${Date.now()}`;
const [a, b] = await Promise.all([instance(key, 10, 10, 60_000), instance(key, 10, 10, 60_000)]);
check(a + b === 10, `two instances, 20 requests at once, limit 10: ${a + b} allowed (${a} + ${b})`);

const k2 = `${key}-window`;
check((await instance(k2, 3, 2, 1500)) === 2, 'a third request inside the window is refused');
await new Promise((r) => setTimeout(r, 1700));
check((await instance(k2, 1, 2, 1500)) === 1, 'after the window passes, requests are allowed again');

check((await instance(`${key}-down`, 3, 1, 60_000, 'postgresql://nobody@127.0.0.1:1/none')) === 3, 'database unreachable: requests are allowed (fails open)');

console.log(failed ? `\nRATE LIMIT: ${failed} FAILED` : '\nRATE LIMIT: ALL PASS');
process.exit(failed ? 1 : 0);
