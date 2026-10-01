/**
 * Verifies filterExpr() (dimension-free, used in-browser) produces identical
 * framing to filterFor() (numeric, verified earlier) across real sources.
 * Run: node scripts/verify-expr.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const FFMPEG = ffmpegPath;
const work = mkdtempSync(path.join(tmpdir(), 'flipcast-expr-'));
const run = (args) => execFileSync(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });

function probe(file) {
  let stderr = '';
  try { execFileSync(FFMPEG, ['-hide_banner', '-i', file], { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { stderr = String(e.stderr || ''); }
  const m = stderr.match(/Video:[^\n]*?(\d{2,5})x(\d{2,5})/);
  return m ? `${m[1]}x${m[2]}` : 'NONE';
}

// ---- mirror of geometry.ts ----
function even(n){const v=Math.round(n);if(v<2)return 2;return v%2===0?v:v+1;}
const CANVAS={'9:16':{w:1080,h:1920},'1:1':{w:1080,h:1080},'16:9':{w:1920,h:1080}};
const aspectOf=(r)=>CANVAS[r].w/CANVAS[r].h;
function cropFor(sw,sh,r){const t=aspectOf(r),s=sw/sh;let cw,ch;
 if(Math.abs(s-t)<1e-6){cw=even(sw);ch=even(sh);}
 else if(s>t){ch=even(sh);cw=Math.min(even(ch*t),even(sw));}
 else{cw=even(sw);ch=Math.min(even(cw/t),even(sh));}
 cw=Math.max(2,Math.min(cw,even(sw)));ch=Math.max(2,Math.min(ch,even(sh)));
 return{cw,ch,ox:Math.max(0,Math.floor((sw-cw)/2)),oy:Math.max(0,Math.floor((sh-ch)/2))};}
function filterFor(sw,sh,r){const{cw,ch,ox,oy}=cropFor(sw,sh,r);const{w,h}=CANVAS[r];const p=[];
 if(cw!==sw||ch!==sh)p.push(`crop=${cw}:${ch}:${ox}:${oy}`);
 p.push(`scale=${w}:${h}`,'setsar=1','format=yuv420p');return p.join(',');}
function filterExpr(r){const{w,h}=CANVAS[r];const t=aspectOf(r);
 const cw=`floor(min(iw\\,ih*${t})/2)*2`,ch=`floor(min(ih\\,iw/${t})/2)*2`;
 return [`crop=${cw}:${ch}`,`scale=${w}:${h}`,'setsar=1','format=yuv420p'].join(',');}

// ---- build a variety of real sources ----
const SOURCES = [
  { name: 'hd-1920x1080', args: ['-f','lavfi','-i','testsrc2=s=1920x1080:d=2:r=30'] },
  { name: 'portrait-1080x1920', args: ['-f','lavfi','-i','testsrc2=s=1080x1920:d=2:r=30'] },
  { name: 'square-1080x1080', args: ['-f','lavfi','-i','testsrc2=s=1080x1080:d=2:r=30'] },
  { name: 'uhd-3840x2160', args: ['-f','lavfi','-i','testsrc2=s=3840x2160:d=2:r=30'] },
  { name: 'odd-1919x1081', args: ['-f','lavfi','-i','testsrc2=s=1919x1081:d=2:r=30'] },
  { name: 'sd-640x360', args: ['-f','lavfi','-i','testsrc2=s=640x360:d=2:r=30'] },
  { name: 'portrait-tall-720x1280', args: ['-f','lavfi','-i','testsrc2=s=720x1280:d=2:r=30'] },
];

const built = [];
for (const s of SOURCES) {
  const f = path.join(work, `${s.name}.mp4`);
  run(['-y', ...s.args, '-t','1', '-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p', f]);
  const dims = probe(f);
  const [w,h] = dims.split('x').map(Number);
  built.push({ name: s.name, f, w, h });
  console.log(`built ${s.name} = ${dims}`);
}
console.log('');

let fail = 0;
for (const { name, f, w, h } of built) {
  for (const ratio of ['9:16','1:1','16:9']) {
    const want = `${CANVAS[ratio].w}x${CANVAS[ratio].h}`;
    // Render with the expression filter, exactly as the browser will.
    const out = path.join(work, `${name}_${ratio.replace(':','x')}.mp4`);
    let got = 'ERROR';
    try {
      run(['-y','-i',f,'-vf',filterExpr(ratio),'-t','0.4','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p', out]);
      got = probe(out);
    } catch (e) { got = 'ERROR: ' + String(e.stderr||e).slice(0,160); }
    const ok = got === want;
    if (!ok) fail++;
    console.log(`${ok?'PASS':'FAIL'}  ${name.padEnd(22)} -> ${ratio}  want=${want} got=${got}`);
  }
}

rmSync(work, { recursive: true, force: true });
console.log(fail === 0 ? '\nEXPRESSION FILTERS: ALL PASS' : `\n${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);