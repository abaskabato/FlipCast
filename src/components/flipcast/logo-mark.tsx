import { useId } from 'react';

/**
 * The Flipcast mark: an F built from the three formats Flipcast makes, a 9:16
 * stem with a play cut-out, a 16:9 arm and a 1:1 square, on the brand
 * gradient. Edges sit on a 16 px grid so it stays crisp small.
 * Same drawing as src/app/icon.svg (the favicon).
 */
export function LogoMark({ size = 36, className }: { size?: number; className?: string }) {
  // Unique per instance: two marks on one page must not share a gradient id.
  const gradient = `fc-mark-${useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ec4899" />
          <stop offset=".55" stopColor="#d946ef" />
          <stop offset="1" stopColor="#fb923c" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill={`url(#${gradient})`} />
      <path
        fill="#fff"
        fillRule="evenodd"
        d="M11 8h14a3 3 0 0 1 3 3v42a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V11a3 3 0 0 1 3-3zM13 24v16l11-8z"
      />
      <rect x="32" y="8" width="24" height="12" rx="3" fill="#fff" />
      <rect x="32" y="24" width="12" height="12" rx="3" fill="#fff" />
    </svg>
  );
}
