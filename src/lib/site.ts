/** Site-wide constants that pages outside the app shell need. */

export const SITE_NAME = 'Flipcast';

/**
 * Where customers write for support, refunds and privacy requests. Shown on the
 * legal pages and in the footer. Unset, those pages fall back to generic copy.
 */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || null;

/** Shown at the top of the legal pages. Bump when their substance changes. */
export const LEGAL_UPDATED = '2 October 2026';
