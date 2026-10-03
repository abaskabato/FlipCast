/**
 * Lets Node run the app's TypeScript modules directly (Node strips the types)
 * by resolving what the bundler allows: extensionless relative imports,
 * directory imports (index.ts), and the `@/` alias for src/.
 * Used by: node --import ./scripts/ts-register.mjs <script>
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const SRC = path.resolve(import.meta.dirname, '..', 'src');

export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) spec = pathToFileURL(path.join(SRC, spec.slice(2))).href;
  try {
    return await next(spec, ctx);
  } catch (e) {
    if (!/^([./]|file:)/.test(spec) || spec.endsWith('.ts')) throw e;
    try {
      return await next(`${spec}.ts`, ctx);
    } catch {
      return next(`${spec}/index.ts`, ctx);
    }
  }
}
