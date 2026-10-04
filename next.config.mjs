/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  async headers() {
    return [
      {
        // Cross-origin isolation unlocks SharedArrayBuffer, which lets us use
        // the multi-threaded ffmpeg core (much faster). The app degrades
        // gracefully to the single-threaded core when these are absent, so
        // this is an optimisation rather than a requirement.
        //
        // COEP:require-corp means every subresource must be same-origin or
        // explicitly grant CORP. We serve all assets ourselves, so this is
        // safe here - but it will block any future third-party embed
        // (analytics pixels, Stripe iframes) unless those send CORP headers.
        source: '/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
        ],
      },
      {
        // The social preview image and icons are meant to be shown on other
        // sites (link previews, bookmarks), so they may be loaded cross-origin.
        // Listed after the rule above, so this value wins for these paths.
        source: '/:file(opengraph-image.png|twitter-image.png|favicon.ico|icon.svg|apple-icon.png)',
        headers: [{ key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' }],
      },
    ];
  },
};

export default nextConfig;