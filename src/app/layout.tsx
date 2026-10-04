import React from 'react';
import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, DM_Sans } from 'next/font/google';
// better-auth-ui's CSS is pulled in from globals.css via @import, so that it
// is processed in the same PostCSS pass as the @tailwind directives it needs.
import './globals.css';

// Self-hosted by next/font, so they satisfy the site's COEP require-corp header.
const sans = DM_Sans({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  // Makes the social preview image URLs absolute (src/app/opengraph-image.png).
  metadataBase: new URL('https://flipcast.dev'),
  title: 'Flipcast — Reframe one clip for every platform, in your browser',
  description:
    'Flipcast turns one horizontal master into platform-ready 9:16, 1:1 and 16:9 cuts. Rendering happens on your device, so your footage never leaves it.',
  applicationName: 'Flipcast',
  openGraph: {
    title: 'Flipcast — reframe once, publish everywhere',
    description:
      'Turn one horizontal clip into 9:16, 1:1 and 16:9 cuts. Rendered locally in your browser; your footage is never uploaded.',
    type: 'website',
    siteName: 'Flipcast',
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Flipcast — reframe once, publish everywhere',
    description:
      'Turn one horizontal clip into 9:16, 1:1 and 16:9 cuts. Rendered locally in your browser; your footage is never uploaded.',
  },
};

export const viewport: Viewport = {
  themeColor: '#0b0912',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${display.variable}`}>
      <body className="min-h-screen font-sans text-zinc-50 antialiased">{children}</body>
    </html>
  );
}