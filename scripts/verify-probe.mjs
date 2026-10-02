/**
 * Verifies the container-metadata probe against real video files, including
 * ones the test browser cannot decode.
 *
 * Runs the same parsing logic as src/lib/video/probe.ts against files produced
 * by a real ffmpeg, and cross-checks duration/dimensions against ffmpeg itself.
 *
 * Run: node scripts/verify-probe.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const work = mkdtempSync(path.join(tmpdir(), 'flipcast-probe-'));
const run = (a) => execFileSync(ffmpegPath, a, { stdio: ['ignore', 'pipe', 'pipe'] });

function ffmpegTruth(file) {
  let stderr = '';
  try { execFileSync(ffmpegPath, ['-hide_banner', '-i', file], { stdio: ['ignore','pipe','pipe'] }); }
  catch (e) { stderr = String(e.stderr || ''); }
  const v = stderr.match(/Video:[^\n]*?(\d{2,5})x(\d{2,5})/);
  const d = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  let dur = NaN;
  if (d) dur = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
  return { dims: v ? `${v[1]}x${v[2]}` : 'NONE', duration: dur };
}

// ---- mirror of src/lib/video/probe.ts parseMp4() ----
function parseMp4(view) {
  const dv = view;
  const readType = (at) => String.fromCharCode(dv.getUint8(at), dv.getUint8(at+1), dv.getUint8(at+2), dv.getUint8(at+3));
  let mvhdPos;
  const tkhdPositions = [];
  const walk = (start, end, depth) => {
    let pos = start;
    while (pos + 8 <= end && depth < 6) {
      let size = dv.getUint32(pos);
      const type = readType(pos + 4);
      let headerSize = 8;
      if (size === 1) {
        if (pos + 16 > end) break;
        size = dv.getUint32(pos + 8) * 2 ** 32 + dv.getUint32(pos + 12);
        headerSize = 16;
      } else if (size === 0) { size = end - pos; }
      if (size < headerSize) break;
      const boxEnd = Math.min(end, pos + size);
      if (type === 'moov' || type === 'trak' || type === 'mdia' || type === 'minf' || type === 'stbl') {
        walk(pos + headerSize, boxEnd, depth + 1);
      } else if (type === 'mvhd') { if (mvhdPos === undefined) mvhdPos = pos; }
      else if (type === 'tkhd') { tkhdPositions.push(pos); }
      pos += size;
    }
  };
  walk(0, dv.byteLength, 0);
  if (mvhdPos === undefined) return null;
  const mvhd = mvhdPos;
  const version = dv.getUint8(mvhd + 8);
  let cursor = mvhd + 12, timescale, duration;
  if (version === 1) {
    cursor += 16;
    timescale = dv.getUint32(cursor);
    duration = Number(dv.getBigUint64(cursor + 4));
  } else {
    cursor += 8;
    timescale = dv.getUint32(cursor);
    duration = dv.getUint32(cursor + 4);
  }
  if (!timescale || !Number.isFinite(duration) || duration <= 0) return null;
  const durationSeconds = duration / timescale;
  let width = 0, height = 0;
  for (const tkhd of tkhdPositions) {
    const tv = dv.getUint8(tkhd + 8);
    const base = tkhd + (tv === 1 ? 96 : 84);
    if (base + 8 > dv.byteLength) continue;
    const w = dv.getUint32(base) / 65536;
    const h = dv.getUint32(base + 4) / 65536;
    if (w > 0 && h > 0) {
      // Quarter-turn rotation in the track matrix (phone portrait video).
      const quarterTurn = dv.getInt32(base - 36) === 0 && dv.getInt32(base - 20) === 0;
      width = quarterTurn ? h : w;
      height = quarterTurn ? w : h;
      break;
    }
  }
  if (!width || !height) return null;
  return { durationSeconds, width: Math.round(width), height: Math.round(height) };
}

const CASES = [
  { name: 'h264-faststart', args: ['-f','lavfi','-i','testsrc2=s=1280x720:d=3:r=30','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart'], ext: 'mp4' },
  { name: 'h264-no-faststart', args: ['-f','lavfi','-i','testsrc2=s=640x480:d=5:r=25','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p'], ext: 'mp4' },
  { name: 'portrait', args: ['-f','lavfi','-i','testsrc2=s=1080x1920:d=2:r=30','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart'], ext: 'mp4' },
  { name: 'mov-container', args: ['-f','lavfi','-i','testsrc2=s=1920x1080:d=4:r=30','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p'], ext: 'mov' },
  { name: 'longer-clip', args: ['-f','lavfi','-i','testsrc2=s=1280x720:d=90:r=30','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart'], ext: 'mp4' },
  // Phone portrait: landscape frames plus a 90 degree display matrix. ffmpeg
  // reports the stored size, so the displayed size is stated explicitly.
  { name: 'phone-rotated-90', args: ['-f','lavfi','-i','testsrc2=s=1920x1080:d=3:r=30','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p'], ext: 'mp4', rotate: 90, expectDims: '1080x1920' },
  { name: 'with-audio', args: ['-f','lavfi','-i','testsrc2=s=854x480:d=6:r=30','-f','lavfi','-i','sine=frequency=440:duration=6','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-shortest','-movflags','+faststart'], ext: 'mp4' },
];

let pass = 0, fail = 0;
for (const c of CASES) {
  const f = path.join(work, `${c.name}.${c.ext}`);
  run(['-y', ...c.args, f]);
  if (c.rotate) {
    const rotated = f.replace(/\.(\w+)$/, '-rot.$1');
    run(['-y', '-display_rotation', String(c.rotate), '-i', f, '-c', 'copy', rotated]);
    run(['-y', '-i', rotated, '-c', 'copy', f]);
  }
  const truth = ffmpegTruth(f);
  if (c.expectDims) truth.dims = c.expectDims;
  const buf = readFileSync(f);
  const parsed = parseMp4(new DataView(buf.buffer, buf.byteOffset, buf.byteLength));

  if (!parsed) { fail++; console.log(`FAIL  ${c.name.padEnd(20)} parser returned null (truth ${truth.dims})`); continue; }

  const gotDims = `${parsed.width}x${parsed.height}`;
  const dimsOk = gotDims === truth.dims;
  // Allow 0.1s tolerance: mvhd timescale rounding.
  const durOk = Math.abs(parsed.durationSeconds - truth.duration) < 0.1;

  if (dimsOk && durOk) pass++; else fail++;
  console.log(
    `${dimsOk && durOk ? 'PASS' : 'FAIL'}  ${c.name.padEnd(20)} dims=${gotDims} (ffmpeg ${truth.dims})  dur=${parsed.durationSeconds.toFixed(3)}s (ffmpeg ${truth.duration.toFixed(3)}s)  ${(statSync(f).size/1024).toFixed(0)}KB` + (dimsOk&&durOk?'':'  <-- MISMATCH'),
  );
}

rmSync(work, { recursive: true, force: true });
console.log(fail === 0 ? '\nPROBE: ALL PASS' : `\n${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);