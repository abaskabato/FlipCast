/**
 * Recognising YouTube links. Flipcast cannot fetch YouTube videos (YouTube
 * blocks downloads from our servers), so a pasted YouTube link instead sends
 * the owner to that video in YouTube Studio, where it can be downloaded.
 *
 * Pure: used by the browser (lib/import/client.ts) and tests.
 */

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

/** That video's page in YouTube Studio, which has a Download option for the owner. */
export function studioUrl(id: string): string {
  return `https://studio.youtube.com/video/${id}/edit`;
}
