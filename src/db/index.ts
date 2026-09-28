import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Always constructible at build time (Pool connects lazily).
// Point DATABASE_URL at Neon, self-hosted Postgres, or local Docker.
const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/flipcast';

export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });
export type AppDB = typeof db;
