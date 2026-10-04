/**
 * Verifies "import from link" with the app's own modules:
 *
 *  - Dropbox and Google Drive share links become direct downloads, and
 *    streaming sites are refused with an explanation;
 *  - the server refuses private, loopback, link-local and metadata addresses,
 *    including a public hostname that resolves to loopback;
 *  - a real public file is fetched in pieces whose sizes and offsets add up to
 *    the whole file, byte for byte.
 *
 * Needs network access. Run: npm run verify:import
 */
import { createHash } from 'node:crypto';

import { normaliseLink, LinkImportError, YouTubeLinkError } from '../src/lib/import/client.ts';
import { studioUrl, youtubeId } from '../src/lib/import/youtube-link.ts';
import { fetchPiece, isPrivateAddress, MAX_CHUNK, validateUrl } from '../src/lib/import/remote.ts';

let failed = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
};
const refuses = async (fn) => {
  try { await fn(); return false; } catch { return true; }
};

// ---- links -------------------------------------------------------------------
check(normaliseLink('https://www.dropbox.com/scl/fi/abc/clip.mp4?rlkey=x&dl=0').searchParams.get('dl') === '1',
  'Dropbox share link -> dl=1');
check(normaliseLink('https://drive.google.com/file/d/1AbC-dEf/view?usp=sharing').toString()
  === 'https://drive.usercontent.google.com/download?id=1AbC-dEf&export=download&confirm=t', 'Google Drive share link -> direct download');
check(normaliseLink('https://drive.google.com/open?id=XYZ').searchParams.get('id') === 'XYZ', 'Google Drive open?id= link');
let yt = null;
try { normaliseLink('https://www.youtube.com/watch?v=abc'); } catch (e) { yt = e; }
check(yt instanceof LinkImportError && /terms/.test(yt.message), 'YouTube refused, with the reason');
check(await refuses(() => normaliseLink('ftp://example.com/a.mp4')), 'non-http links refused');

// YouTube: recognised in every common form, and sent to YouTube Studio.
const ID = 'dQw4w9WgXcQ';
const forms = [
  `https://www.youtube.com/watch?v=${ID}&t=42s`,
  `https://youtu.be/${ID}?si=abc`,
  `https://m.youtube.com/watch?v=${ID}`,
  `https://www.youtube.com/shorts/${ID}`,
  `https://www.youtube.com/live/${ID}?feature=share`,
  `https://www.youtube.com/embed/${ID}`,
  `https://music.youtube.com/watch?v=${ID}&list=RD`,
];
check(forms.every((f) => youtubeId(f) === ID), 'YouTube links are recognised in all their forms');
check(youtubeId('https://www.youtube.com/@flipcast') === null && youtubeId('https://example.com/watch?v=dQw4w9WgXcQ') === null, 'channel pages and other sites are not mistaken for videos');
let ytErr;
try { normaliseLink(forms[1]); } catch (e) { ytErr = e; }
check(ytErr instanceof YouTubeLinkError && ytErr.videoId === ID, 'a YouTube link raises the guided-download error with its video id');
check(studioUrl(ID) === `https://studio.youtube.com/video/${ID}/edit`, 'the help links to that video in YouTube Studio');

// ---- addresses -----------------------------------------------------------------
for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
  check(isPrivateAddress(ip), `private address refused: ${ip}`);
}
check(!isPrivateAddress('93.184.216.34') && !isPrivateAddress('2606:4700::1111'), 'public addresses allowed');
check(await refuses(() => validateUrl('http://169.254.169.254/latest/meta-data/')), 'metadata URL refused before connecting');
check(await refuses(() => validateUrl('http://user:pw@example.com/a.mp4')), 'credentials in links refused');
check(await refuses(() => fetchPiece('http://localtest.me/a.mp4', 0)), 'public hostname resolving to 127.0.0.1 refused at connect');

// ---- a real file, in pieces ------------------------------------------------------
// Over 4 MB, so it must come back in more than one piece.
const URL_ = 'https://flipcast.dev/models/efficientdet_lite0.tflite';
const whole = Buffer.from(await (await fetch(URL_)).arrayBuffer());
const pieces = [];
for (let start = 0; ; ) {
  const p = await fetchPiece(URL_, start);
  pieces.push(p);
  start = p.end + 1;
  if (p.total !== null && start >= p.total) break;
  if (pieces.length > 10) break;
}
const joined = Buffer.concat(pieces.map((p) => p.body));
const sha = (b) => createHash('sha256').update(b).digest('hex');
check(pieces.length === Math.ceil(whole.length / MAX_CHUNK) && pieces.every((p) => p.body.length <= MAX_CHUNK),
  `fetched in ${pieces.length} piece(s) of at most 4 MB`);
check(joined.length === whole.length && sha(joined) === sha(whole), `pieces rebuild the file byte for byte (${joined.length} bytes)`);
check(await refuses(() => fetchPiece('https://flipcast.dev/', 0)), 'a web page (HTML) is refused');

console.log(failed ? `\nIMPORT: ${failed} FAILED` : '\nIMPORT: ALL PASS');
process.exit(failed ? 1 : 0);
