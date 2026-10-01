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
    ];
  },
};

export default nextConfig;