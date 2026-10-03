/**
 * Large static files (engine binaries, caption fonts, detection models, demo
 * clips) load from jsDelivr, a free CDN for npm packages and public GitHub
 * repos, so they do not count against the site's own bandwidth. Every one of
 * them is also served from /public, and each loader falls back to that copy
 * when the CDN fails, so the CDN is never on the critical path.
 *
 * URLs are pinned to exact package versions and an exact commit, which
 * jsDelivr serves immutably. jsDelivr sends `Access-Control-Allow-Origin: *`
 * and `Cross-Origin-Resource-Policy: cross-origin`, which the page's
 * COEP: require-corp needs. `npm run verify:cdn` checks every mapped file is
 * byte-identical to the local copy; run it after bumping one of the versions
 * below or changing a file in public/fonts, public/models or public/demo.
 *
 * Only the big binaries move. Small JavaScript loaders stay same-origin,
 * because browsers only start workers from the page's own origin.
 *
 * Set NEXT_PUBLIC_ASSET_CDN=0 to serve everything from the site again.
 */

const NPM = 'https://cdn.jsdelivr.net/npm';

/** Must match the installed packages (checked by scripts/verify-cdn-assets.mjs). */
export const CDN_PACKAGES = {
  ffmpegCore: '0.12.10',
  ffmpegCoreMt: '0.12.10',
  onnxRuntime: '1.31.0-dev.20260914-8d85527a0',
  mediapipeVision: '1.0.1',
} as const;

/**
 * The last commit that changed public/fonts, public/models or public/demo.
 * The repository is public, so jsDelivr serves those files at this commit.
 */
export const REPO_ASSETS_COMMIT = 'f3d499162efd54b89a29cdf08a78c2f632d4f9de';
const REPO = `https://cdn.jsdelivr.net/gh/abaskabato/FlipCast@${REPO_ASSETS_COMMIT}/public`;

/** Local path prefix -> CDN prefix. Only files listed here leave the origin. */
export const CDN_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ['/ffmpeg/0.12.10/', `${NPM}/@ffmpeg/core@${CDN_PACKAGES.ffmpegCore}/dist/esm/`],
  ['/ffmpeg/mt/', `${NPM}/@ffmpeg/core-mt@${CDN_PACKAGES.ffmpegCoreMt}/dist/esm/`],
  ['/ort/', `${NPM}/onnxruntime-web@${CDN_PACKAGES.onnxRuntime}/dist/`],
  ['/mediapipe/', `${NPM}/@mediapipe/tasks-vision@${CDN_PACKAGES.mediapipeVision}/wasm/`],
  ['/fonts/', `${REPO}/fonts/`],
  ['/models/', `${REPO}/models/`],
  ['/demo/', `${REPO}/demo/`],
];

export function cdnEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ASSET_CDN !== '0';
}

/** The CDN URL for a local /public path, or null if it has no CDN copy. */
export function cdnUrl(localPath: string): string | null {
  if (!cdnEnabled()) return null;
  for (const [local, cdn] of CDN_PREFIXES) {
    if (localPath.startsWith(local)) return cdn + localPath.slice(local.length);
  }
  return null;
}

/** The URL to try first: the CDN copy when there is one, else the local path. */
export function preferCdn(localPath: string): string {
  return cdnUrl(localPath) ?? localPath;
}

/**
 * Run `load` with the CDN URL, and again with the local path if that fails.
 * `load` receives a function mapping local paths to the URLs to use, so a
 * loader that needs several files switches all of them together.
 */
export async function withCdnFallback<T>(
  label: string,
  load: (url: (localPath: string) => string) => Promise<T>,
): Promise<T> {
  if (!cdnEnabled()) return load((p) => p);
  try {
    return await load(preferCdn);
  } catch (e) {
    console.warn(`[assets] ${label}: CDN failed, using this site's copy`, e);
    return load((p) => p);
  }
}

/** fetch() a /public file from the CDN, falling back to the site's copy. */
export async function fetchAsset(localPath: string, init?: RequestInit): Promise<Response> {
  const cdn = cdnUrl(localPath);
  if (cdn) {
    try {
      const res = await fetch(cdn, init);
      if (res.ok) return res;
      console.warn(`[assets] ${localPath}: CDN answered ${res.status}, using this site's copy`);
    } catch (e) {
      console.warn(`[assets] ${localPath}: CDN failed, using this site's copy`, e);
    }
  }
  return fetch(localPath, init);
}
