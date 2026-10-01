import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Always constructible at build time (Pool connects lazily).
// Point DATABASE_URL at Neon, self-hosted Postgres, or local Docker.
const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/flipcast';

/**
 * Serverless connection limits.
 *
 * On Vercel each serverless invocation gets its own module instance, so every
 * cold start builds a *new* Pool. Postgres allows only ~100 connections per
 * user by default, so a burst of concurrent requests exhausts the limit and
 * every route starts failing with `too many clients already` - typically right
 * after a deploy or a traffic spike, which makes it look unrelated to the DB.
 *
 * A small per-instance max plus a short idle timeout keeps the total bounded.
 * This is a per-instance ceiling, not a global one; the durable fix is a
 * pooled connection string (Neon and Supabase both offer one), which is why
 * DATABASE_URL_POOLED is preferred below when present.
 */
const isServerless =
  !!process.env.VERCEL || process.env.NODE_ENV === 'production';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL_POOLED || connectionString,
  max: isServerless ? 3 : 10,
  // Close sockets quickly rather than holding them across idle serverless
  // instances.
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  // Neon/Supabase pooled endpoints route over TLS and need SNI to pick the
  // right host; harmless against a direct connection.
  ssl: process.env.DATABASE_URL_POOLED ? { rejectUnauthorized: false } : undefined,
});

export const db = drizzle(pool, { schema });
export type AppDB = typeof db;
