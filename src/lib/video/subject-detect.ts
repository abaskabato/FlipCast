'use client';

/**
 * Finds the main subject (a face) through a clip, on the user's device.
 *
 * Frames come from a <video> element (the browser's own, usually hardware,
 * decoder) seeked to each sample time, and go through MediaPipe's BlazeFace
 * detector. Everything (the WASM runtime and the model) is served from our
 * origin, so the footage still never leaves the device.
 *
 * The short-range model expects faces that fill a good part of the image, but
 * in a landscape podcast or interview shot a face may be well under a sixth of
 * the frame width. So each frame is also scanned as overlapping squares along
 * its long side, which makes a small face proportionally three times larger to
 * the detector. Detections from all passes are merged.
 *
 * Wide two-shots defeat a face model even with tiles: speakers turned towards
 * each other are in profile. So when fewer than two faces are found, a person
 * detector (EfficientDet-Lite0) also runs, and each person with no face inside
 * their box contributes a head estimated from the top of that box.
 */

import { sampleTimes, type FaceBox, type SubjectSample } from './tracking';

const WASM_BASE = '/mediapipe';
const MODEL_URL = '/models/blaze_face_short_range.tflite';
const PERSON_MODEL_URL = '/models/efficientdet_lite0.tflite';

/** Long side the frame is drawn at before detection. Plenty for a 128px model. */
const FRAME_LONG_SIDE = 960;
const TILE_SIZE = 384;

type Box = { x: number; y: number; w: number; h: number; score: number };

type Detector = {
  detect(image: HTMLCanvasElement): {
    detections: {
      boundingBox?: { originX: number; originY: number; width: number; height: number };
      categories: { score: number }[];
    }[];
  };
  close(): void;
};

export class TrackingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrackingUnavailableError';
  }
}

type PersonDetector = {
  detect(image: HTMLCanvasElement): {
    detections: {
      boundingBox?: { originX: number; originY: number; width: number; height: number };
    }[];
  };
};

let detectorPromise: Promise<Detector> | null = null;
let personPromise: Promise<PersonDetector | null> | null = null;

/** The person detector is a helper: if it cannot load, faces alone still work. */
async function getPersonDetector(): Promise<PersonDetector | null> {
  personPromise ??= (async () => {
    try {
      const { ObjectDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      return (await ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: PERSON_MODEL_URL, delegate: 'CPU' },
        runningMode: 'IMAGE',
        categoryAllowlist: ['person'],
        scoreThreshold: 0.4,
        maxResults: 4,
      })) as unknown as PersonDetector;
    } catch (e) {
      console.warn('[track] person detector unavailable:', e);
      return null;
    }
  })();
  return personPromise;
}

/**
 * Heads of detected people who have no detected face, as face-shaped boxes.
 * A seated or standing person's head is about the top fifth of their box and
 * about a third of its width; small people (background, posters) are ignored.
 */
function headsFromPeople(people: PersonDetector, frame: HTMLCanvasElement, faces: Box[]): Box[] {
  const W = frame.width;
  const H = frame.height;
  const heads: Box[] = [];
  for (const d of people.detect(frame).detections) {
    const b = d.boundingBox;
    if (!b || b.height < H * 0.25) continue;
    const box = { x: b.originX / W, y: b.originY / H, w: b.width / W, h: b.height / H };
    const hasFace = faces.some((f) => {
      const cx = f.x + f.w / 2;
      const cy = f.y + f.h / 2;
      return cx > box.x && cx < box.x + box.w && cy > box.y && cy < box.y + box.h;
    });
    if (hasFace) continue;
    const hw = Math.min(box.w * 0.4, (box.h * 0.2 * H) / W);
    const hh = (hw * W) / H;
    heads.push({ x: box.x + box.w / 2 - hw / 2, y: box.y + box.h * 0.04, w: hw, h: hh, score: 0.5 });
  }
  return heads;
}

async function getDetector(): Promise<Detector> {
  detectorPromise ??= (async () => {
    const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    return (await FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.5,
    })) as unknown as Detector;
  })().catch((e) => {
    detectorPromise = null;
    throw e;
  });
  return detectorPromise;
}

/** Load the clip into a muted, offscreen <video> that we can seek. */
function openVideo(file: File): Promise<{ video: HTMLVideoElement; release: () => void }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  const release = () => {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  };
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      release();
      reject(new TrackingUnavailableError('This browser could not open the video to find the subject.'));
    }, 15_000);
    video.onloadeddata = () => {
      window.clearTimeout(timer);
      if (!video.videoWidth || !video.videoHeight) {
        release();
        reject(new TrackingUnavailableError('This browser cannot decode the video to find the subject.'));
        return;
      }
      resolve({ video, release });
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      release();
      reject(new TrackingUnavailableError('This browser cannot decode the video to find the subject.'));
    };
  });
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('seek timed out')), 8_000);
    video.onseeked = () => {
      window.clearTimeout(timer);
      resolve();
    };
    video.currentTime = t;
  });
}

/** Overlap of two boxes, as intersection over union. */
function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
}

/** Every face in the frame, in frame fractions, de-duplicated across passes. */
function detectFaces(detector: Detector, frame: HTMLCanvasElement, tile: HTMLCanvasElement): Box[] {
  const W = frame.width;
  const H = frame.height;
  const boxes: Box[] = [];

  const run = (source: HTMLCanvasElement, sx: number, sy: number, scale: number) => {
    for (const d of detector.detect(source).detections) {
      const b = d.boundingBox;
      if (!b) continue;
      boxes.push({
        x: (sx + b.originX * scale) / W,
        y: (sy + b.originY * scale) / H,
        w: (b.width * scale) / W,
        h: (b.height * scale) / H,
        score: d.categories[0]?.score ?? 0,
      });
    }
  };

  // Whole frame: catches faces that already fill the shot.
  run(frame, 0, 0, 1);

  // Overlapping squares along the long side.
  const side = Math.min(W, H);
  const span = Math.max(W, H) - side;
  if (span > side * 0.15) {
    const ctx = tile.getContext('2d', { willReadFrequently: false })!;
    const scale = side / TILE_SIZE;
    for (const f of [0, 0.5, 1]) {
      const sx = W >= H ? span * f : 0;
      const sy = W >= H ? 0 : span * f;
      ctx.drawImage(frame, sx, sy, side, side, 0, 0, TILE_SIZE, TILE_SIZE);
      run(tile, sx, sy, scale);
    }
  }

  // Keep the most confident of any overlapping detections.
  boxes.sort((a, b) => b.score - a.score);
  const kept: Box[] = [];
  for (const b of boxes) if (!kept.some((k) => iou(k, b) > 0.3)) kept.push(b);
  return kept;
}

/**
 * Pick the subject: the largest face, favouring the one nearest the previous
 * pick so the crop does not hop between people of similar size.
 */
function pickSubject(faces: Box[], prev: { x: number; y: number } | null): Box | null {
  let best: Box | null = null;
  let bestScore = -1;
  for (const f of faces) {
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    const near = prev ? 1 / (1 + 4 * Math.hypot(cx - prev.x, cy - prev.y)) : 1;
    const s = f.w * f.h * near;
    if (s > bestScore) {
      bestScore = s;
      best = f;
    }
  }
  return best;
}

/**
 * Sample the clip and return where the subject's face is at each sample time.
 * Throws TrackingUnavailableError when the browser cannot decode the file.
 */
export async function detectSubject(
  file: File,
  duration: number,
  opts: {
    signal?: AbortSignal;
    onProgress?: (fraction: number) => void;
    /** Only look at this stretch; sample times come back relative to its start. */
    range?: { start: number; end: number } | null;
  } = {},
): Promise<SubjectSample[]> {
  const [detector, people, { video, release }] = await Promise.all([
    getDetector(),
    getPersonDetector(),
    openVideo(file),
  ]);
  try {
    const scale = FRAME_LONG_SIDE / Math.max(video.videoWidth, video.videoHeight);
    const frame = document.createElement('canvas');
    frame.width = Math.round(video.videoWidth * Math.min(1, scale));
    frame.height = Math.round(video.videoHeight * Math.min(1, scale));
    const fctx = frame.getContext('2d', { willReadFrequently: false })!;
    const tile = document.createElement('canvas');
    tile.width = TILE_SIZE;
    tile.height = TILE_SIZE;

    const full = Math.min(duration, video.duration || duration);
    const from = opts.range ? Math.max(0, Math.min(full, opts.range.start)) : 0;
    const to = opts.range ? Math.max(from, Math.min(full, opts.range.end)) : full;
    const times = sampleTimes(to - from).map((t) => t + from);
    const samples: SubjectSample[] = [];
    let prev: { x: number; y: number } | null = null;

    for (let i = 0; i < times.length; i++) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      await seek(video, times[i]);
      fctx.drawImage(video, 0, 0, frame.width, frame.height);
      let found = detectFaces(detector, frame, tile);
      if (found.length < 2 && people) found = [...found, ...headsFromPeople(people, frame, found)];
      // Every face, for the split-screen decision (layout.ts).
      const faces: FaceBox[] = found.map((f) => ({ cx: f.x + f.w / 2, cy: f.y + f.h * 0.45, w: f.w }));
      const subject = pickSubject(found, prev);
      if (subject) {
        // Centre on the eyes rather than the middle of the box, which keeps
        // natural headroom when the crop also moves vertically.
        prev = { x: subject.x + subject.w / 2, y: subject.y + subject.h * 0.45 };
        samples.push({ t: times[i] - from, ...prev, faces });
      } else {
        samples.push({ t: times[i] - from, x: null, y: null, faces });
      }
      opts.onProgress?.((i + 1) / times.length);
    }
    return samples;
  } finally {
    release();
  }
}
