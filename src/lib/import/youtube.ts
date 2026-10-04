import 'server-only';

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * YouTube link import, server side: yt-dlp (bin/yt-dlp, fetched and checksum-
 * verified by scripts/fetch-ytdlp.mjs) looks a video up and downloads it.
 *
 * Users may only import videos they own or have permission to use; the
 * import box says so.
 *
 * Node only.
 */

export class YouTubeImportError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = 'YouTubeImportError';
    this.status = status;
  }
}

/** The 11-character video id in a YouTube link, or null if it is not one. */
export function youtubeId(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v') ?? /^\/(?:shorts|live|embed|v)\/([\w-]{11})/.exec(url.pathname)?.[1] ?? null;
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

const binary = () => path.join(process.cwd(), 'bin', 'yt-dlp');

/** Whether yt-dlp is available in this deployment. */
export function youtubeImportAvailable(): boolean {
  return existsSync(binary());
}

/** Turn yt-dlp's error output into something a user can act on. */
function explain(stderr: string): YouTubeImportError {
  if (/confirm you.?re not a bot|Sign in to confirm/i.test(stderr)) {
    return new YouTubeImportError('YouTube is not letting us fetch videos right now. Download the video and upload the file instead.', 503);
  }
  if (/Private video/i.test(stderr)) return new YouTubeImportError('That video is private.', 422);
  if (/age|inappropriate|confirm your age/i.test(stderr)) return new YouTubeImportError('That video is age-restricted, so it cannot be imported.', 422);
  if (/members-only|Join this channel/i.test(stderr)) return new YouTubeImportError('That video is for channel members only.', 422);
  if (/unavailable|removed|does not exist|not available/i.test(stderr)) return new YouTubeImportError('That video is unavailable.', 422);
  return new YouTubeImportError('Could not get that video from YouTube.', 502);
}

/** Run yt-dlp; resolves with stdout, or rejects with a user-facing error. */
export function runYtDlp(args: string[], { timeoutMs = 60_000, maxOutput = 8 * 1024 * 1024 } = {}): Promise<string> {
  if (!youtubeImportAvailable()) return Promise.reject(new YouTubeImportError('YouTube import is not available here.', 503));
  return new Promise((resolve, reject) => {
    const child = spawn(binary(), ['--no-cache-dir', '--no-warnings', '--no-playlist', ...args], {
      // The standalone build unpacks itself into TMPDIR; /tmp is the only
      // writable place in a serverless function.
      env: { ...process.env, TMPDIR: '/tmp', HOME: '/tmp', XDG_CACHE_HOME: '/tmp' },
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new YouTubeImportError('YouTube took too long to answer. Try again.', 504));
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString();
      if (out.length > maxOutput) child.kill('SIGKILL');
    });
    child.stderr.on('data', (d: Buffer) => {
      err = (err + d.toString()).slice(-4000);
    });
    child.on('error', () => {
      clearTimeout(timer);
      reject(new YouTubeImportError('YouTube import is not available here.', 503));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else {
        console.warn('[youtube] yt-dlp failed:', err.slice(-600));
        reject(explain(err));
      }
    });
  });
}

type YtFormat = {
  format_id: string;
  ext?: string;
  /** "https" for a plain download, "m3u8_native" for HLS. */
  protocol?: string;
  vcodec?: string;
  acodec?: string;
  height?: number;
  tbr?: number;
  filesize?: number;
  filesize_approx?: number;
};

export type YouTubeVideo = {
  id: string;
  title: string;
  durationSeconds: number;
  /** H.264 video (no audio), at most 720p. */
  video: { formatId: string; height: number; bytes: number | null };
  /** AAC audio. */
  audio: { formatId: string; bytes: number | null };
};

const size = (f: YtFormat) => f.filesize ?? f.filesize_approx ?? null;

/**
 * Look a video up and choose what to download: H.264 video (which every
 * browser and the render engine decode; YouTube otherwise prefers AV1) at up
 * to 720p, and AAC audio.
 */
export async function lookUpVideo(id: string): Promise<YouTubeVideo> {
  const json = JSON.parse(await runYtDlp(['-J', '--skip-download', `https://www.youtube.com/watch?v=${id}`])) as {
    title?: string;
    duration?: number;
    live_status?: string;
    formats?: YtFormat[];
  };
  if (json.live_status && json.live_status !== 'not_live' && json.live_status !== 'was_live') {
    throw new YouTubeImportError('Live streams cannot be imported. Try again once the stream has ended.', 422);
  }
  // Plain downloads first: they are quicker than HLS and their size is known.
  const formats = (json.formats ?? []).filter((f) => f.protocol === 'https');
  const video = formats
    .filter((f) => f.vcodec?.startsWith('avc1') && (!f.acodec || f.acodec === 'none') && f.ext === 'mp4' && (f.height ?? 0) <= 720)
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.tbr ?? 0) - (a.tbr ?? 0))[0];
  const audio = formats
    .filter((f) => f.acodec?.startsWith('mp4a') && (!f.vcodec || f.vcodec === 'none') && f.ext === 'm4a')
    .sort((a, b) => (b.tbr ?? 0) - (a.tbr ?? 0))[0];
  if (!video || !audio) throw new YouTubeImportError('That video has no format we can use.', 422);
  return {
    id,
    title: json.title ?? 'YouTube video',
    durationSeconds: Math.round(json.duration ?? 0),
    video: { formatId: video.format_id, height: video.height ?? 0, bytes: size(video) },
    audio: { formatId: audio.format_id, bytes: size(audio) },
  };
}
