/**
 * The kinds of browser-side error Flipcast reports, and the clean-up applied
 * before one is stored. Pure: shared by the browser (reporting) and the API
 * route (validation).
 */

export const CLIENT_ERROR_KINDS = ['probe', 'tracking', 'captions', 'clips', 'unhandled'] as const;
export type ClientErrorKind = (typeof CLIENT_ERROR_KINDS)[number];

const VIDEO_FILE = /[^\s"'/\\:]+\.(mp4|mov|m4v|webm|mkv|avi|mpe?g|3gp|wav|mp3|m4a)\b/gi;

/** Drop anything that looks like a user's file name, and cap the length. */
export function scrub(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const s = text.replace(VIDEO_FILE, '<file>').trim().slice(0, max);
  return s || null;
}

/** Errors that come from browser extensions or harmless browser quirks. */
export function isNoise(message: string, stack?: string | null): boolean {
  return (
    /ResizeObserver loop|Script error\.?$|Load failed$|NetworkError when attempting/i.test(message) ||
    /(chrome|moz|safari)-extension:\/\//.test(stack ?? '')
  );
}
