/**
 * Quota model.
 *
 * Quota is measured in *source* video seconds rendered per calendar month. A
 * dual-format job consumes `sourceSeconds` once (not twice) — the customer
 * pays for their footage, not for the number of exports we derive from it.
 */

/** Supported output formats. Kept here so API and client cannot drift apart. */
export const RATIOS = ['9:16', '1:1', '16:9'] as const;
export type RatioId = (typeof RATIOS)[number];

/**
 * Monthly allowance per tier, in seconds of source.
 *
 * Rendering and transcription run on the user's device, so a minute costs us
 * almost nothing; these are set to beat cloud tools on minutes per dollar
 * (Opus Clip Starter: 150 min for $15; Creator here: 300 min for $12). Free
 * matches Opus Clip's free 60 min, but with no watermark and no expiry.
 */
export const TIER_LIMITS: Record<string, number> = {
  free: 3600, // 60 minutes of source per month
  creator: 18000, // 5 hours
  agency: 90000, // 25 hours
};

export const TIER_PRICE_LABEL: Record<string, string> = {
  free: 'Free',
  creator: 'Creator',
  agency: 'Agency',
};

export function tierLimit(tier: string | null | undefined): number {
  if (!tier) return TIER_LIMITS.free;
  return TIER_LIMITS[tier] ?? TIER_LIMITS.free;
}

/** Largest single source we will accept, in seconds. */
export const MAX_SOURCE_SECONDS = {
  free: 600, // 10 minutes
  creator: 1800, // 30 minutes
  agency: 3600, // 60 minutes
} as const;

export function maxSourceSeconds(tier: string | null | undefined): number {
  const limit = tier ? (MAX_SOURCE_SECONDS as Record<string, number>)[tier] : undefined;
  return limit ?? MAX_SOURCE_SECONDS.free;
}

/**
 * Browser-side WASM encoding is memory-bound, not compute-bound. Beyond this
 * the tab risks an OOM crash rather than a clean error, so refuse up front.
 */
export const BROWSER_MAX_INPUT_BYTES = 400 * 1024 * 1024;

export type QuotaDecision =
  | { ok: true; limit: number; used: number; remaining: number }
  | { ok: false; reason: string; limit: number; used: number; remaining: number };

/**
 * Decide whether `seconds` of additional source video may be rendered.
 * `limitOverride` is the user's bespoke cap when one is set.
 */
export function checkQuota(args: {
  tier: string | null | undefined;
  used: number;
  seconds: number;
  limitOverride?: number | null;
}): QuotaDecision {
  const limit = args.limitOverride ?? tierLimit(args.tier);
  const used = Math.max(0, args.used);
  const remaining = Math.max(0, limit - used);

  if (args.seconds <= 0) {
    return { ok: false, reason: 'Could not read the duration of that video.', limit, used, remaining };
  }
  if (args.seconds > maxSourceSeconds(args.tier)) {
    const cap = maxSourceSeconds(args.tier);
    return {
      ok: false,
      reason: `That clip is longer than the ${Math.round(cap / 60)} min limit on your plan.`,
      limit,
      used,
      remaining,
    };
  }
  if (args.seconds > remaining) {
    return {
      ok: false,
      reason: `Not enough render time left. This clip needs ${formatDuration(args.seconds)} but you have ${formatDuration(remaining)} remaining.`,
      limit,
      used,
      remaining,
    };
  }
  return { ok: true, limit, used, remaining: limit - used - args.seconds };
}

/** 95 -> "1:35". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** 95 -> "1m 35s", for quota copy. */
export function formatQuota(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m}m ${r}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}