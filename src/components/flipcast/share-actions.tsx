'use client';

import { useEffect, useState } from 'react';
import { Download, ExternalLink, Share2 } from 'lucide-react';

import type { RenderedOutput } from '@/lib/video/ffmpeg-client';
import type { Ratio } from '@/lib/video/geometry';

/**
 * Get a rendered clip onto a social platform without it touching our servers.
 *
 * Where the browser can share files (iOS/Android, and some desktop browsers)
 * "Share" opens the system share sheet with the video attached, so TikTok,
 * Instagram or YouTube open with the clip ready to post. Everywhere else, a
 * platform button downloads the clip and opens that platform's upload page.
 *
 * True auto-posting needs each platform's API (app review, OAuth tokens and,
 * for Instagram, a publicly hosted copy of the video), so it is deliberately
 * not done here.
 */

type Platform = { name: string; url: string; hint: string };

const TIKTOK: Platform = {
  name: 'TikTok',
  url: 'https://www.tiktok.com/upload',
  hint: 'Pick the downloaded file in the TikTok tab.',
};
const YT_SHORTS: Platform = {
  name: 'YouTube Shorts',
  url: 'https://www.youtube.com/upload',
  hint: 'Upload the downloaded file — vertical clips under 3 minutes post as Shorts.',
};
const YOUTUBE: Platform = {
  name: 'YouTube',
  url: 'https://www.youtube.com/upload',
  hint: 'Pick the downloaded file in the YouTube Studio tab.',
};
const REELS: Platform = {
  name: 'Instagram Reels',
  url: 'https://www.instagram.com/',
  hint: 'In the Instagram tab, click + Create and choose the downloaded file.',
};
const INSTAGRAM: Platform = { ...REELS, name: 'Instagram' };
const LINKEDIN: Platform = {
  name: 'LinkedIn',
  url: 'https://www.linkedin.com/feed/?shareActive=true',
  hint: 'In the LinkedIn tab, add a video and choose the downloaded file.',
};
const X: Platform = {
  name: 'X',
  url: 'https://x.com/compose/post',
  hint: 'In the X tab, attach the downloaded file.',
};

/** Where each shape actually performs, most natural first. */
const PLATFORMS: Record<Ratio, Platform[]> = {
  '9:16': [TIKTOK, YT_SHORTS, REELS],
  '1:1': [INSTAGRAM, LINKEDIN, X],
  '16:9': [YOUTUBE, LINKEDIN, X],
};

function asFile(output: RenderedOutput): File {
  return new File([output.blob], output.filename, { type: 'video/mp4' });
}

export default function ShareActions({
  output,
  onDownload,
}: {
  output: RenderedOutput;
  onDownload: (output: RenderedOutput) => void;
}) {
  // Decided after mount: navigator is absent during server render, and
  // canShare depends on the actual file (some browsers cap shareable size).
  const [canShareFile, setCanShareFile] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    try {
      setCanShareFile(
        typeof navigator !== 'undefined' &&
          typeof navigator.canShare === 'function' &&
          navigator.canShare({ files: [asFile(output)] }),
      );
    } catch {
      setCanShareFile(false);
    }
  }, [output]);

  const share = async () => {
    setHint(null);
    try {
      await navigator.share({ files: [asFile(output)], title: output.filename });
    } catch (e) {
      // Closing the sheet is not an error worth showing.
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setHint('Sharing is not available here — download the clip or pick a platform below.');
    }
  };

  const postTo = (platform: Platform) => {
    onDownload(output);
    // Opened in the same click so popup blockers allow it.
    window.open(platform.url, '_blank', 'noopener,noreferrer');
    setHint(`Downloaded. ${platform.hint}`);
  };

  return (
    <div className="mt-auto space-y-3">
      <div className="flex gap-2">
        {canShareFile && (
          <button onClick={() => void share()} className="fc-btn-primary flex-1">
            <Share2 className="h-4 w-4" />
            Share
          </button>
        )}
        <button
          onClick={() => onDownload(output)}
          className={canShareFile ? 'fc-btn-secondary' : 'fc-btn-primary w-full'}
          aria-label={`Download ${output.ratio}`}
        >
          <Download className="h-4 w-4" />
          {canShareFile ? <span className="sr-only sm:not-sr-only">Download</span> : 'Download'}
        </button>
      </div>

      <div>
        <p className="fc-meta mb-1.5">Post to</p>
        <div className="flex flex-wrap gap-1.5">
          {PLATFORMS[output.ratio].map((p) => (
            <button
              key={p.name}
              onClick={() => postTo(p)}
              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-xs font-semibold text-slate-200 transition-colors hover:border-slate-600 hover:bg-slate-800"
            >
              {p.name}
              <ExternalLink className="h-3 w-3 text-slate-500" />
            </button>
          ))}
        </div>
      </div>

      <p className="fc-meta min-h-[1rem] text-emerald-300/90" aria-live="polite">
        {hint}
      </p>
    </div>
  );
}
