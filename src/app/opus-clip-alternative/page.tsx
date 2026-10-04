import type { Metadata } from 'next';

import { ComparePage } from '@/components/flipcast/compare-page';
import { MAX_SOURCE_SECONDS, TIER_LIMITS } from '@/lib/quotas';

export const metadata: Metadata = {
  title: 'Free Opus Clip alternative, no watermark — Flipcast',
  description:
    'Flipcast finds the best clips in your video and cuts captioned 9:16, 1:1 and 16:9 versions in your browser. No watermark, no upload, no credits, and your clips never expire.',
  alternates: { canonical: '/opus-clip-alternative' },
};

const freeMinutes = TIER_LIMITS.free / 60;
const freeMaxMinutes = MAX_SOURCE_SECONDS.free / 60;

export default function OpusClipAlternativePage() {
  return (
    <ComparePage
      eyebrow="Opus Clip alternative"
      title={
        <>
          Opus Clip, without the <span className="fc-gradient-text">watermark, upload or wait.</span>
        </>
      }
      intro="Flipcast finds the moments worth posting in your video and cuts captioned vertical, square and widescreen clips, all inside your browser. Your video is never uploaded, there is no queue, and the files are yours to keep."
      them="Opus Clip"
      rows={[
        { feature: 'Price to start', us: `Free: ${freeMinutes} minutes of video a month, no card`, them: 'Free plan, or $15/month (Starter)', usWins: true },
        { feature: 'Watermark', us: 'None, on any plan', them: 'On animated captions on the free plan', usWins: true },
        { feature: 'How long clips are kept', us: 'They are files on your device: forever', them: '3 days on Free, 29 days on Starter', usWins: true },
        { feature: 'Your video', us: 'Never leaves your device', them: 'Uploaded to their servers' , usWins: true },
        { feature: 'Waiting', us: 'Starts right away, on your device', them: 'Processing queue; faster on paid plans', usWins: true },
        { feature: 'AI clip finding', us: 'Yes, free, on your device', them: 'Yes', usWins: true },
        { feature: 'Render many clips at once', us: 'Yes, free', them: 'Bulk export on Pro ($29/month)', usWins: true },
        { feature: 'Speaker tracking and split screen', us: 'Yes, free', them: 'Dynamic layout on Free; object tracking on Pro', usWins: true },
        { feature: 'Captions in any language, editable', us: 'Yes, free', them: 'Yes', usWins: true },
        { feature: 'Import from YouTube', us: 'No: upload the file, or a Dropbox or Drive link', them: 'From Starter ($15/month)' },
        { feature: 'AI B-roll, team workspace', us: 'No', them: 'Pro ($29/month)' },
      ]}
      checked={
        <>
          Compared in October 2026 against Opus Clip&apos;s public pricing page (opus.pro/pricing). Their plans
          change, so check there before deciding.
        </>
      }
      betterElsewhere={{
        heading: 'When Opus Clip is the better choice',
        points: [
          'Your computer is old or slow. Flipcast renders on your device, so a fast laptop renders fast and an old one takes a while; Opus Clip renders on their servers.',
          'You want to paste YouTube, Zoom or Twitch links instead of uploading a file.',
          `Your videos are long. Flipcast's free plan takes videos up to ${freeMaxMinutes} minutes, and it processes the file in your browser.`,
          'You need AI B-roll, a shared team workspace or an API.',
        ],
      }}
      steps={[
        { title: 'Drop in a video', body: 'An MP4, MOV, WebM or MKV file, or a Dropbox or Google Drive link. It opens in this tab; nothing is uploaded.' },
        { title: 'Find the best clips', body: 'Flipcast ranks the stretches with a strong opening and a clean ending. Tick the ones you want and fix any caption words.' },
        { title: 'Render and post', body: 'Every ticked clip comes out in 9:16, 1:1 and 16:9 with captions, ready for TikTok, Reels, Shorts, YouTube and LinkedIn.' },
      ]}
      faq={[
        { q: 'Is Flipcast really free?', a: `Yes. Free includes ${freeMinutes} minutes of video a month, every format, AI clip finding, speaker tracking and captions, with no watermark and no card.` },
        { q: 'Why is there no watermark or expiry?', a: 'Your clips are rendered on your own device, so they cost us almost nothing to make and we never store them. They are files you download and keep.' },
        { q: 'How does it find clips without uploading?', a: 'Speech is transcribed by a model that runs in your browser, then each stretch is scored on its hook, whether it starts and ends on complete thoughts, and its pacing. The transcript never leaves your device.' },
        { q: 'Can I move my existing Opus Clip projects?', a: 'Download your original videos (or clips) from Opus Clip and drop them into Flipcast. There is nothing to migrate: Flipcast keeps no projects on a server.' },
      ]}
    />
  );
}
