/**
 * Applies pending database migrations (drizzle/) during the production build
 * on Vercel, before `next build`, so deployed code never runs against a schema
 * it does not expect. Better Auth reads and writes whole user rows, so a
 * missing column breaks sign-in outright.
 *
 * Production only (VERCEL_ENV=production): previews and local builds skip it.
 * If a migration fails the build fails, and the live site stays on the
 * previous deployment. Migrations must therefore stay additive (new tables,
 * new nullable columns), since the old code keeps serving until the new
 * deployment is promoted.
 *
 * Run: node scripts/migrate-production.mjs (from `npm run build`)
 */
import { spawnSync } from 'node:child_process';

if (process.env.VERCEL_ENV !== 'production') {
  console.log('[migrate] not a production build; skipping database migrations.');
  process.exit(0);
}

// A direct connection: the pooler is not meant for schema changes.
const url = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
if (!url) {
  console.error('[migrate] no DATABASE_URL_UNPOOLED or DATABASE_URL; refusing to build without a database.');
  process.exit(1);
}

const result = spawnSync('npx', ['drizzle-kit', 'migrate'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: url },
});
if (result.status !== 0) {
  console.error('[migrate] migrations failed; stopping the build so the live site keeps the previous version.');
  process.exit(result.status ?? 1);
}
console.log('[migrate] database is up to date.');
