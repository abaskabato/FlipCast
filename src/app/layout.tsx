import React from 'react';
import type { Metadata, Viewport } from 'next';
// better-auth-ui's CSS is pulled in from globals.css via @import, so that it
// is processed in the same PostCSS pass as the @tailwind directives it needs.
import './globals.css';

export const metadata: Metadata = {
  title: 'Flipcast — Reframe one clip for every platform, in your browser',
  description:
    'Flipcast turns one horizontal master into platform-ready 9:16, 1:1 and 16:9 cuts. Rendering happens on your device, so your footage never leaves it.',
  applicationName: 'Flipcast',
  openGraph: {
    title: 'Flipcast — reframe once, publish everywhere',
    description:
      'Turn one horizontal clip into 9:16, 1:1 and 16:9 cuts. Rendered locally in your browser; your footage is never uploaded.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#020617',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-slate-950 text-slate-50 antialiased">{children}</body>
    </html>
  );
}