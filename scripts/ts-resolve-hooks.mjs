/**
 * Lets Node run the app's TypeScript modules directly (Node strips the types)
 * by resolving what the bundler allows: extensionless relative imports,
 * directory imports (index.ts), the `@/` alias for src/, and package subpaths
 * like next/server that have no exports map.
 * Used by: node --import ./scripts/ts-register.mjs <script>
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const SRC = path.resolve(import.meta.dirname, '..', 'src');

export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) spec = pathToFileURL(path.join(SRC, spec.slice(2))).href;
  // Next.js supplies this marker while bundling; outside it, it is a no-op.
  if (spec === 'server-only') return { url: 'data:text/javascript,', shortCircuit: true };
  try {
    return await next(spec, ctx);
  } catch (e) {
    // Package subpaths without an exports map (next/server) need the .js
    // the bundler would have added.
    if (/^[\w@][^:]*\/[^/]+$/.test(spec) && !/\.\w+$/.test(spec)) return next(`${spec}.js`, ctx);
    if (!/^([./]|file:)/.test(spec) || spec.endsWith('.ts')) throw e;
    try {
      return await next(`${spec}.ts`, ctx);
    } catch {
      return next(`${spec}/index.ts`, ctx);
    }
  }
}
