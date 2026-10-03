/**
 * The TikTok post fields the browser sends, validated. Shared by the post-now
 * and schedule routes. Node only.
 */

import { z } from 'zod';

import { BROWSER_MAX_INPUT_BYTES } from '@/lib/quotas';

export const TikTokPostBody = z.object({
  accountId: z.string(),
  title: z.string().max(2200).default(''),
  // No default: TikTok requires the creator to choose.
  privacy: z.string().min(1),
  disableComment: z.boolean(),
  disableDuet: z.boolean(),
  disableStitch: z.boolean(),
  brandContent: z.boolean(),
  brandOrganic: z.boolean(),
  sizeBytes: z.number().int().positive().max(BROWSER_MAX_INPUT_BYTES),
  durationSec: z.number().positive(),
});

export type TikTokPostBody = z.infer<typeof TikTokPostBody>;

export const optionsOf = (b: TikTokPostBody) =>
  JSON.stringify({
    disableComment: b.disableComment,
    disableDuet: b.disableDuet,
    disableStitch: b.disableStitch,
    brandContent: b.brandContent,
    brandOrganic: b.brandOrganic,
  });
