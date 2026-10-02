/**
 * Verifies the render plan and the ffmpeg command built from it, using the
 * app's own modules (probe.ts, ffmpeg-client.ts) and a real ffmpeg:
 *
 *  - outputs are sized to the crop's real detail (720- vs 1080-class);
 *  - an output identical to an 8-bit H.264 source is stream-copied;
 *  - HEVC and cropped outputs are re-encoded to H.264;
 *  - one invocation produces every output, with audio when the source has it;
 *  - a phone clip stored with a 90 degree rotation is measured and copied upright.
 *
 * Run: npm run verify:plan
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, openAsBlob, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

import { buildArgs, planRender } from '../src/lib/video/ffmpeg-client.ts';
import { probeVideo } from '../src/lib/video/probe.ts';

const work = mkdtempSync(path.join(tmpdir(), 'flipcast-plan-'));
const ff = (args) => execFileSync(ffmpegPath, ['-v', 'error', '-y', ...args]);
const lavfi = (size, secs, audio) => [
  '-f', 'lavfi', '-i', `testsrc2=s=${size}:d=${secs}:r=30`,
  ...(audio ? ['-f', 'lavfi', '-i', `sine=duration=${secs}`, '-c:a', 'aac', '-shortest'] : []),
];

function make(name, size, { codec = 'libx264', audio = false, rotate } = {}) {
  const f = path.join(work, name);
  ff([...lavfi(size, 2, audio), '-c:v', codec, '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    ...(codec === 'libx265' ? ['-tag:v', 'hvc1', '-x265-params', 'log-level=error'] : []), f]);
  if (rotate) {
    const tmp = `${f}.rot.mp4`;
    ff(['-display_rotation', String(rotate), '-i', f, '-c', 'copy', tmp]);
    ff(['-i', tmp, '-c', 'copy', f]);
  }
  return f;
}

function inspect(file) {
  const s = spawnSync(ffmpegPath, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr;
  const v = /Video: (\w+)[^\n]*?(\d{3,4})x(\d{3,4})/.exec(s);
  const rot = /rotation of (-?[\d.]+)/.exec(s)?.[1];
  // Displayed size: a quarter-turn swaps the stored dimensions.
  const turned = rot && Math.abs(Number(rot)) % 180 === 90;
  return { codec: v?.[1], dims: v ? (turned ? `${v[3]}x${v[2]}` : `${v[2]}x${v[3]}`) : 'none', audio: /Audio:/.test(s) };
}

const CASES = [
  { name: '1080p H.264, all formats', src: () => make('a.mp4', '1920x1080', { audio: true }), ratios: ['9:16', '1:1', '16:9'],
    want: { '9:16': ['720x1280', 'encode'], '1:1': ['1080x1080', 'encode'], '16:9': ['1920x1080', 'copy'] }, audio: true },
  { name: '4K H.264, vertical', src: () => make('b.mp4', '3840x2160'), ratios: ['9:16'],
    want: { '9:16': ['1080x1920', 'encode'] } },
  { name: '720p H.264, widescreen', src: () => make('c.mp4', '1280x720'), ratios: ['16:9'],
    want: { '16:9': ['1280x720', 'copy'] } },
  { name: '1080p HEVC, widescreen', src: () => make('d.mp4', '1920x1080', { codec: 'libx265' }), ratios: ['16:9'],
    want: { '16:9': ['1920x1080', 'encode'] } },
  { name: 'phone portrait (rotated 90)', src: () => make('e.mp4', '1920x1080', { rotate: 90 }), ratios: ['9:16', '16:9'],
    want: { '9:16': ['1080x1920', 'copy'], '16:9': ['1280x720', 'encode'] } },
];

let fail = 0;
for (const c of CASES) {
  const src = c.src();
  const meta = await probeVideo(new File([await openAsBlob(src)], path.basename(src), { type: 'video/mp4' }));
  const plan = planRender(c.ratios, meta);
  const args = buildArgs(src, plan, null).map((a) => (/^out-/.test(a) ? path.join(work, a) : a));
  ff(args);
  for (const p of plan) {
    const got = inspect(path.join(work, p.outName));
    const [dims, mode] = c.want[p.ratio];
    const problems = [
      p.copy !== (mode === 'copy') && `planned ${p.copy ? 'copy' : 'encode'}, want ${mode}`,
      got.dims !== dims && `dims ${got.dims}, want ${dims}`,
      got.codec !== 'h264' && `codec ${got.codec}`,
      Boolean(c.audio) !== got.audio && `audio=${got.audio}`,
    ].filter(Boolean);
    if (problems.length) fail++;
    console.log(`${problems.length ? 'FAIL' : 'PASS'}  ${c.name.padEnd(30)} ${p.ratio.padEnd(5)} ${mode.padEnd(6)} ${got.dims}  ${problems.join('; ')}`);
  }
}

rmSync(work, { recursive: true, force: true });
console.log(fail === 0 ? '\nRENDER PLAN: ALL PASS' : `\n${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
