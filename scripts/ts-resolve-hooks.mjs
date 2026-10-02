/**
 * Lets Node run the app's TypeScript modules directly (Node strips the types)
 * by resolving the extensionless relative imports the bundler allows.
 * Used by: node --import ./scripts/ts-register.mjs <script>
 */
export async function resolve(spec, ctx, next) {
  try {
    return await next(spec, ctx);
  } catch (e) {
    if (/^[./]/.test(spec) && !spec.endsWith('.ts')) return next(`${spec}.ts`, ctx);
    throw e;
  }
}
