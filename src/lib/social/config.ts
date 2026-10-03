/**
 * Which publishing features this deployment can offer, from the environment.
 *
 * Every piece is optional, and the UI only offers what is configured:
 *
 *   SOCIAL_TOKEN_KEY                  32-byte base64 key for stored tokens (required for any of it)
 *   YOUTUBE_CLIENT_ID / _SECRET       Google OAuth client with the YouTube Data API enabled
 *   TIKTOK_CLIENT_KEY / _SECRET       TikTok app with Login Kit and the Content Posting API
 *   SOCIAL_SCHEDULER_ENABLED=1        an every-5-minutes cron for /api/social/cron is set up (Vercel Pro)
 *   CRON_SECRET                       authorises that cron
 *   BLOB_READ_WRITE_TOKEN             private Blob store for TikTok posts scheduled for later
 *
 * Node only.
 */

const set = (name: string) => Boolean(process.env[name]?.trim());

export type SocialConfig = {
  youtube: boolean;
  tiktok: boolean;
  /** TikTok cannot schedule natively; this needs storage plus our scheduler. */
  tiktokScheduling: boolean;
};

export function socialConfig(): SocialConfig {
  const base = set('SOCIAL_TOKEN_KEY') && set('BETTER_AUTH_SECRET');
  const tiktok = base && set('TIKTOK_CLIENT_KEY') && set('TIKTOK_CLIENT_SECRET');
  return {
    youtube: base && set('YOUTUBE_CLIENT_ID') && set('YOUTUBE_CLIENT_SECRET'),
    tiktok,
    tiktokScheduling:
      tiktok && process.env.SOCIAL_SCHEDULER_ENABLED === '1' && set('CRON_SECRET') && set('BLOB_READ_WRITE_TOKEN'),
  };
}

/** The public origin OAuth providers redirect back to (must match their console). */
export function siteOrigin(): string {
  return (process.env.BETTER_AUTH_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

export const redirectUri = (platform: 'youtube' | 'tiktok') => `${siteOrigin()}/api/social/${platform}/callback`;

/** Overridable endpoints, so tests can point the clients at local stand-ins. */
export const endpoints = {
  googleAuth: () => process.env.GOOGLE_AUTH_BASE || 'https://accounts.google.com',
  googleToken: () => process.env.GOOGLE_TOKEN_BASE || 'https://oauth2.googleapis.com',
  youtube: () => process.env.YOUTUBE_API_BASE || 'https://www.googleapis.com',
  tiktokAuth: () => process.env.TIKTOK_AUTH_BASE || 'https://www.tiktok.com',
  tiktok: () => process.env.TIKTOK_API_BASE || 'https://open.tiktokapis.com',
};
