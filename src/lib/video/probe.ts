'use client';

/**
 * Read duration and dimensions from a video file.
 *
 * Strategy, cheapest first:
 *  1. Parse the MP4/MOV container directly from the file header. This needs no
 *     codec support at all, so it works in browsers that cannot decode H.264
 *     (some Linux Chromium builds, older WebViews, headless test runners).
 *  2. Fall back to a detached <video> element for formats we cannot parse.
 *
 * This matters because the browser render engine (ffmpeg.wasm) can transcode
 * files that the browser itself refuses to decode. Gating on <video> support
 * would reject exactly the files we can still process.
 */

export type VideoMeta = {
  durationSeconds: number;
  width: number;
  height: number;
  /**
   * Video sample-entry fourcc (avc1, hvc1, ...), when the container could be
   * parsed. Unknown for formats read through the <video> fallback.
   */
  codec?: string;
  /** H.264 profile_idc from avcC (66 Baseline, 77 Main, 100 High, ...). */
  h264Profile?: number;
};

const VIDEO_FOURCCS = new Set(['avc1', 'avc3', 'hvc1', 'hev1', 'vp09', 'av01', 'mp4v', 'ap4h', 'apcn', 'apch']);

const PROBE_TIMEOUT_MS = 20_000;
/** Containers to inspect directly. Others fall through to <video>. */
const PARSEABLE_EXT = /\.(mp4|m4v|mov|qt|m4a)$/i;

/**
 * Parse `moov` → `mvhd` (duration) and the first video `trak` → `tkhd`
 * (display dimensions) from an ISO base media file.
 */
function parseMp4(view: DataView): VideoMeta | null {
  const dv = view;
  let offset = 0;

  const readType = (at: number): string =>
    String.fromCharCode(
      dv.getUint8(at),
      dv.getUint8(at + 1),
      dv.getUint8(at + 2),
      dv.getUint8(at + 3),
    );

  // Boxes nest, so walk the tree collecting every `tkhd` candidate. We cannot
  // just keep the first one: audio tracks also carry a tkhd with width/height
  // of 0, and taking it would report a 0x0 frame.
  let mvhdPos: number | undefined;
  const tkhdPositions: number[] = [];
  const stsdPositions: number[] = [];

  const walk = (start: number, end: number, depth: number): void => {
    let pos = start;
    while (pos + 8 <= end && depth < 6) {
      let size = dv.getUint32(pos);
      const type = readType(pos + 4);
      let headerSize = 8;

      if (size === 1) {
        // 64-bit size
        if (pos + 16 > end) break;
        const hi = dv.getUint32(pos + 8);
        const lo = dv.getUint32(pos + 12);
        size = hi * 2 ** 32 + lo;
        headerSize = 16;
      } else if (size === 0) {
        size = end - pos; // extends to end of file
      }
      if (size < headerSize) break;

      const boxEnd = Math.min(end, pos + size);
      if (type === 'moov' || type === 'trak' || type === 'mdia' || type === 'minf' || type === 'stbl') {
        walk(pos + headerSize, boxEnd, depth + 1);
      } else if (type === 'mvhd') {
        mvhdPos ??= pos;
      } else if (type === 'tkhd') {
        tkhdPositions.push(pos);
      } else if (type === 'stsd') {
        stsdPositions.push(pos);
      }

      pos += size;
    }
  };

  walk(0, dv.byteLength, 0);
  if (mvhdPos === undefined) return null;
  const mvhd = mvhdPos;

  // ---- mvhd: version(1) flags(3) then created/modified/timescale/duration ----
  const version = dv.getUint8(mvhd + 8);
  let cursor = mvhd + 12; // skip full box header + version/flags
  let timescale: number;
  let duration: number;

  if (version === 1) {
    cursor += 16; // created + modified (64-bit each)
    timescale = dv.getUint32(cursor);
    duration = Number(dv.getBigUint64(cursor + 4));
  } else {
    cursor += 8; // created + modified (32-bit each)
    timescale = dv.getUint32(cursor);
    duration = dv.getUint32(cursor + 4);
  }
  if (!timescale || !Number.isFinite(duration) || duration <= 0) return null;
  const durationSeconds = duration / timescale;

  // ---- tkhd: fixed 16.16 display width/height at the end of the box ----
  // Pick the first candidate with non-zero dimensions, i.e. the video track.
  // Version/flags(4) + created(4|8) + modified(4|8) + trackID(4) + reserved(4)
  // + duration(4|8) + reserved(8) + layer(2) + altGroup(2) + volume(2)
  // + reserved(2) + matrix(36) puts width at +84 (v0) / +96 (v1).
  let width = 0;
  let height = 0;
  for (const tkhd of tkhdPositions) {
    const tkhdVersion = dv.getUint8(tkhd + 8);
    const dimBase = tkhd + (tkhdVersion === 1 ? 96 : 84);
    if (dimBase + 8 > dv.byteLength) continue;
    const w = dv.getUint32(dimBase) / 65536;
    const h = dv.getUint32(dimBase + 4) / 65536;
    if (w > 0 && h > 0) {
      // Phones record portrait video as a landscape frame plus a rotation in
      // the track matrix (the 36 bytes before width). ffmpeg applies it when
      // decoding, so report the displayed shape: for a 90/270 degree turn the
      // matrix diagonal is zero and width/height swap.
      const a = dv.getInt32(dimBase - 36);
      const d = dv.getInt32(dimBase - 36 + 16);
      const quarterTurn = a === 0 && d === 0;
      width = quarterTurn ? h : w;
      height = quarterTurn ? w : h;
      break;
    }
  }

  if (!width || !height) return null;
  return {
    durationSeconds,
    width: Math.round(width),
    height: Math.round(height),
    ...videoCodecOf(dv, stsdPositions),
  };
}

/**
 * The video codec, from the first sample description that names one.
 *
 * stsd is a full box: header(8) + version/flags(4) + entry_count(4), then the
 * first sample entry, whose own header carries the fourcc. For H.264 the
 * profile is read from the avcC child so callers can tell an ordinary 8-bit
 * stream (safe to copy into any platform) from 10-bit or 4:2:2 variants.
 */
function videoCodecOf(dv: DataView, stsdPositions: number[]): Pick<VideoMeta, 'codec' | 'h264Profile'> {
  const fourcc = (at: number) =>
    String.fromCharCode(dv.getUint8(at), dv.getUint8(at + 1), dv.getUint8(at + 2), dv.getUint8(at + 3));
  for (const stsd of stsdPositions) {
    const entry = stsd + 16;
    if (entry + 8 > dv.byteLength) continue;
    const codec = fourcc(entry + 4);
    if (!VIDEO_FOURCCS.has(codec)) continue;
    if (codec !== 'avc1' && codec !== 'avc3') return { codec };
    // avcC sits among the sample entry's children; scan its extent for it.
    const end = Math.min(dv.byteLength - 10, entry + dv.getUint32(entry));
    for (let at = entry + 8; at < end; at++) {
      if (fourcc(at) === 'avcC') return { codec, h264Profile: dv.getUint8(at + 5) };
    }
    return { codec };
  }
  return {};
}

/** Largest `moov` we will read. Real ones are KBs to a few MB, even for long clips. */
const MAX_MOOV_BYTES = 64 * 1024 * 1024;

/**
 * Find the top-level `moov` box by hopping box headers, then read only it.
 *
 * Cameras and phones usually write `moov` *after* the media data, i.e. at the
 * end of a file that can be hundreds of MB. Reading a fixed window from the
 * head misses it, and the <video> fallback then fails wherever the browser
 * cannot decode the codec (HEVC in most of Firefox and Chrome) - even though
 * the WASM engine could render the file fine. Top-level boxes are few (ftyp,
 * free, mdat, moov, ...), so this costs a handful of 16-byte reads plus the
 * moov itself, regardless of file size.
 */
async function readMoov(file: File): Promise<DataView | null> {
  let pos = 0;
  for (let hops = 0; hops < 64 && pos + 8 <= file.size; hops++) {
    const head = new DataView(await file.slice(pos, pos + 16).arrayBuffer());
    let size = head.getUint32(0);
    const type = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7));
    if (size === 1) {
      if (head.byteLength < 16) return null;
      size = head.getUint32(8) * 2 ** 32 + head.getUint32(12);
    } else if (size === 0) {
      size = file.size - pos; // runs to end of file
    }
    if (size < 8) return null; // corrupt
    if (type === 'moov') {
      if (size > MAX_MOOV_BYTES) return null;
      return new DataView(await file.slice(pos, pos + size).arrayBuffer());
    }
    pos += size;
  }
  return null;
}

async function probeMp4(file: File): Promise<VideoMeta | null> {
  try {
    const moov = await readMoov(file);
    // parseMp4 walks from offset 0 and descends into `moov`, so the box on its
    // own parses exactly as it would inside the whole file.
    return moov ? parseMp4(moov) : null;
  } catch {
    return null;
  }
}

function probeWithVideoElement(file: File): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;

    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
    };

    const timer = setTimeout(() => {
      if (settled) return;
      cleanup();
      reject(new Error('Could not read this video. It may be corrupt or use an unsupported codec.'));
    }, PROBE_TIMEOUT_MS);

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = () => {
      if (settled) return;
      const { duration, videoWidth: width, videoHeight: height } = video;
      cleanup();
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error('Could not determine the duration of this video.'));
        return;
      }
      if (!width || !height) {
        reject(new Error('Could not determine the dimensions of this video.'));
        return;
      }
      resolve({ durationSeconds: duration, width, height });
    };

    video.onerror = () => {
      if (settled) return;
      cleanup();
      reject(
        new Error(
          'Could not read this video. It may be corrupt, or use a codec this browser cannot decode.',
        ),
      );
    };

    video.src = url;
  });
}

export async function probeVideo(file: File): Promise<VideoMeta> {
  if (PARSEABLE_EXT.test(file.name) || file.type.includes('mp4') || file.type.includes('quicktime')) {
    const parsed = await probeMp4(file);
    if (parsed) return parsed;
  }
  return probeWithVideoElement(file);
}

/** Human-readable size for the UI. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}