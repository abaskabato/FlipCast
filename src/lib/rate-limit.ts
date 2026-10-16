import { randomUUID } from 'node:crypto';

import { pool } from '@/db';

/**
 * Rate limits that hold across every server instance: the counts live in
 * Postgres (table rate_limit), not in one instance's memory. Each call is a
 * single atomic statement, so concurrent requests cannot both slip under the
 * limit. Fixed windows: the count resets once `windowMs` has passed since the
 * window started.
 *
 * Fails open: if the database cannot be reached the request is allowed, so a
 * database hiccup degrades protection rather than taking the site down.
 */
export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  try {
    const { rows } = await pool.query<{ count: number }>(
      `insert into rate_limit (id, key, count, last_request) values ($1, $2, 1, $3)
       on conflict (key) do update set
         count = case when rate_limit.last_request <= $3 - $4 then 1 else rate_limit.count + 1 end,
         last_request = case when rate_limit.last_request <= $3 - $4 then $3 else rate_limit.last_request end
       returning count`,
      [randomUUID(), `app:${key}`, now, windowMs],
    );
    // Now and then, clear counters that have not been touched for a day.
    if (Math.random() < 0.01) {
      void pool.query(`delete from rate_limit where last_request < $1`, [now - 24 * 60 * 60 * 1000]).catch(() => undefined);
    }
    return Number(rows[0]?.count ?? 1) <= limit;
  } catch (e) {
    console.warn('[rate-limit] database unavailable, allowing request:', e instanceof Error ? e.message : e);
    return true;
  }
}

export function clientIp(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    'unknown'
  );
}
