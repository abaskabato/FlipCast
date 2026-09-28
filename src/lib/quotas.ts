export const TIER_LIMITS: Record<string, number> = {
  free: 180,
  creator: 3600,
  agency: 14400,
};

export function tierLimit(tier: string | null | undefined): number {
  if (!tier) return TIER_LIMITS.free;
  return TIER_LIMITS[tier] ?? TIER_LIMITS.free;
}
