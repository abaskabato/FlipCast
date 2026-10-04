/**
 * Where a sign-up came from, for /admin's "Sign-ups by source": the link's
 * tag (?ref=tiktok or ?utm_source=tiktok) and the referring site's host.
 * Only those two short strings are kept, never full URLs.
 *
 * Pure: shared by the browser (capture) and the API route (validation).
 */

export type SignupSource = { source: string | null; referrer: string | null };

/** A tag like "tiktok" or "x_launch": lowercase letters, digits, - and _. */
export function cleanSource(raw: string | null | undefined): string | null {
  const s = raw?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  return s || null;
}

/** Just the host of a referring URL ("www.tiktok.com" -> "tiktok.com"). */
export function cleanReferrer(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
    return /^[a-z0-9.-]{1,100}$/.test(host) ? host : null;
  } catch {
    return null;
  }
}
