import type { MetadataRoute } from 'next';

const SITE = 'https://flipcast.dev';

/** The public pages search engines should find. Account and auth pages are left out. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE}/pricing`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE}/opus-clip-alternative`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE}/podcast-clip-maker`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE}/terms`, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
