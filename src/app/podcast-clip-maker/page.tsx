import type { Metadata } from 'next';

import { ComparePage } from '@/components/flipcast/compare-page';
import { MAX_SOURCE_SECONDS, TIER_LIMITS } from '@/lib/quotas';

export const metadata: Metadata = {
  title: 'Free podcast clip maker with captions — Flipcast',
  description:
    'Turn a video podcast into captioned clips for TikTok, Reels and Shorts. Flipcast finds the best moments, keeps both hosts in frame with split screen, and runs in your browser. Free, no watermark.',
  alternates: { canonical: '/podcast-clip-maker' },
};

const freeMinutes = TIER_LIMITS.free / 60;
const freeMaxMinutes = MAX_SOURCE_SECONDS.free / 60;

export default function PodcastClipMakerPage() {
  return (
    <ComparePage
      eyebrow="Podcast clip maker"
      title={
        <>
          Your podcast, cut into <span className="fc-gradient-text">clips people finish.</span>
        </>
      }
      intro="Drop in a video podcast. Flipcast finds the moments that stand on their own, keeps both hosts in frame with split screen, and burns in captions people can read with the sound off. It all runs in your browser, so your episode is never uploaded."
      rows={[
        { feature: 'Finds the moments worth posting', us: 'Strong openings, complete thoughts, good pacing, ranked for you', them: '', usWins: true },
        { feature: 'Two people on camera', us: 'Split screen stacks both hosts in the 9:16 cut, and switches back when the camera cuts to one', them: '', usWins: true },
        { feature: 'Follows whoever is talking', us: 'Auto-track keeps the speaker in frame as they move', them: '', usWins: true },
        { feature: 'Captions', us: 'Word-by-word, in dozens of languages, editable before you render, plus an .srt file', them: '', usWins: true },
        { feature: 'Every platform at once', us: '9:16 for TikTok, Reels and Shorts; 1:1 for Instagram and LinkedIn; 16:9 for YouTube and X', them: '', usWins: true },
        { feature: 'Many clips at once', us: 'Tick the suggestions you like and render them all in one go', them: '', usWins: true },
        { feature: 'Watermark', us: 'None, even on the free plan', them: '', usWins: true },
        { feature: 'Episode length', us: `Free: videos up to ${freeMaxMinutes} minutes and ${freeMinutes} minutes a month. Trim a longer episode to its best stretch first.`, them: '' },
      ]}
      steps={[
        { title: 'Drop in the episode', body: 'The video file, or a Dropbox or Google Drive link. It opens in this tab; nothing is uploaded.' },
        { title: 'Pick the moments', body: 'Choose a clip length and let Flipcast suggest the best stretches. Tick the ones you want and check the caption words.' },
        { title: 'Render and post', body: 'Get every clip in vertical, square and widescreen, with captions, ready to post or schedule.' },
      ]}
      faq={[
        { q: 'Does it work with Riverside, Zoom or StreamYard recordings?', a: 'Yes, as long as you have the video file (MP4, MOV, WebM or MKV). Export or download the recording, then drop it in.' },
        { q: 'What if the hosts are in separate frames?', a: 'Auto-track finds every face in the shot. When two people are on camera together, the vertical cut stacks them with split screen.' },
        { q: 'Which languages do captions support?', a: 'Dozens, detected automatically, including Spanish, Portuguese, French, German, Hindi, Arabic, Japanese, Korean and Chinese, each in a font made for its script.' },
        { q: 'Is my unreleased episode safe?', a: 'It never leaves your computer. Transcription, clip finding and rendering all run in your browser.' },
      ]}
    />
  );
}
