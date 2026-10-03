/**
 * Browser side of "import from link": turn a pasted link into a File.
 *
 * 1. Share links from Dropbox and Google Drive become direct download links.
 * 2. The browser fetches the file itself when the host allows cross-origin
 *    requests (GitHub, most S3/R2/GCS buckets, many CDNs): no server involved.
 * 3. Otherwise it asks /api/import for the file in pieces of at most 4 MB and
 *    joins them; the server passes each piece through and stores nothing.
 *
 * Streaming sites (YouTube, TikTok, Instagram...) are refused: downloading
 * from them breaks their terms of service.
 */

/** Hosts whose pages are players, not files, and whose terms forbid downloading. */
const STREAMING_HOSTS =
  /(^|\.)(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|x\.com|twitter\.com|vimeo\.com|twitch\.tv|linkedin\.com|loom\.com)$/i;

export class LinkImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinkImportError';
  }
}

/** The direct-download form of a share link, or the link unchanged. */
export function normaliseLink(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new LinkImportError('That is not a valid link.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new LinkImportError('Only http and https links work.');
  if (STREAMING_HOSTS.test(url.hostname)) {
    throw new LinkImportError(
      `${url.hostname.replace(/^www\./, '')} links cannot be imported: their terms do not allow downloading. Download your own video from there, then upload the file.`,
    );
  }

  // Dropbox: ?dl=0 opens a preview page; dl=1 serves the file.
  if (/(^|\.)dropbox\.com$/i.test(url.hostname)) {
    url.searchParams.set('dl', '1');
    return url;
  }

  // Google Drive: /file/d/<id>/view, /open?id=<id> or uc?id=<id> -> direct download.
  if (/(^|\.)drive\.google\.com$/i.test(url.hostname) || /(^|\.)docs\.google\.com$/i.test(url.hostname)) {
    const id = /\/file\/d\/([\w-]+)/.exec(url.pathname)?.[1] ?? url.searchParams.get('id');
    if (!id) throw new LinkImportError('That Google Drive link does not point to a file.');
    return new URL(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`);
  }
  return url;
}

/** A sensible file name from the link, keeping a video extension. */
export function fileNameFor(url: URL, type: string): string {
  const last = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '');
  if (/\.(mp4|mov|webm|mkv|m4v)$/i.test(last)) return last;
  const ext = type.includes('quicktime') ? 'mov' : type.includes('webm') ? 'webm' : type.includes('matroska') ? 'mkv' : 'mp4';
  return `linked-video.${ext}`;
}

type Progress = (loaded: number, total: number | null) => void;

/** Read a response body with progress, refusing anything over `max` bytes. */
async function readBody(res: Response, max: number, onProgress: Progress, signal?: AbortSignal): Promise<Blob> {
  const total = Number(res.headers.get('content-length')) || null;
  if (total && total > max) throw new LinkImportError('That file is too large to render in the browser.');
  if (!res.body) return res.blob();
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const { done, value } = await reader.read();
    if (done) break;
    loaded += value.byteLength;
    if (loaded > max) throw new LinkImportError('That file is too large to render in the browser.');
    parts.push(value);
    onProgress(loaded, total);
  }
  return new Blob(parts as BlobPart[]);
}

async function viaProxy(url: URL, max: number, onProgress: Progress, signal?: AbortSignal): Promise<{ blob: Blob; type: string }> {
  const piece = async (start: number) => {
    const res = await fetch(`/api/import?url=${encodeURIComponent(url.toString())}&start=${start}`, { signal });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new LinkImportError(
        res.status === 401 ? 'Sign in to import from this link.' : (body.error ?? 'Could not import that link.'),
      );
    }
    return {
      data: new Uint8Array(await res.arrayBuffer()),
      total: Number(res.headers.get('x-import-total')) || null,
      chunk: Number(res.headers.get('x-import-chunk')) || 4 * 1024 * 1024,
      type: res.headers.get('x-import-type') ?? '',
    };
  };

  const first = await piece(0);
  const total = first.total ?? first.data.byteLength;
  if (total > max) throw new LinkImportError('That file is too large to render in the browser.');
  if (first.type.startsWith('text/html')) throw new LinkImportError('That link opens a web page, not a video file.');

  const starts: number[] = [];
  for (let s = first.data.byteLength; s < total; s += first.chunk) starts.push(s);
  const parts = new Array<Uint8Array>(starts.length + 1);
  parts[0] = first.data;
  let loaded = first.data.byteLength;
  onProgress(loaded, total);

  // A few pieces in flight at once: faster than one, gentle on the host.
  let next = 0;
  const worker = async () => {
    while (next < starts.length) {
      const i = next++;
      const p = await piece(starts[i]);
      parts[i + 1] = p.data;
      loaded += p.data.byteLength;
      onProgress(loaded, total);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { blob: new Blob(parts as BlobPart[]), type: first.type };
}

/**
 * Fetch the video behind `raw` as a File. `onProgress` gets bytes so far and
 * the total when known. Throws LinkImportError with a message fit for users.
 */
export async function importFromLink(
  raw: string,
  opts: { maxBytes: number; onProgress?: Progress; signal?: AbortSignal },
): Promise<File> {
  const url = normaliseLink(raw);
  const onProgress = opts.onProgress ?? (() => undefined);

  let blob: Blob;
  let type = '';
  let direct: Response | null = null;
  try {
    // Fails with a TypeError when the host does not allow cross-origin reads.
    direct = await fetch(url, { mode: 'cors', credentials: 'omit', signal: opts.signal });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    direct = null;
  }

  if (direct?.ok && !(direct.headers.get('content-type') ?? '').startsWith('text/html')) {
    type = direct.headers.get('content-type') ?? '';
    blob = await readBody(direct, opts.maxBytes, onProgress, opts.signal);
  } else {
    ({ blob, type } = await viaProxy(url, opts.maxBytes, onProgress, opts.signal));
  }

  if (blob.size === 0) throw new LinkImportError('That link returned an empty file.');
  const videoType = type.startsWith('video/') ? type : 'video/mp4';
  return new File([blob], fileNameFor(url, videoType), { type: videoType });
}
