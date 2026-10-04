import type { MetadataRoute } from 'next';

/** Crawl the public pages; keep the API and signed-in pages out of search. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/admin', '/account', '/auth/', '/reset-password'] },
    sitemap: 'https://flipcast.dev/sitemap.xml',
    host: 'https://flipcast.dev',
  };
}
