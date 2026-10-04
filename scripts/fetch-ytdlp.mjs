/**
 * Fetches yt-dlp (the standalone Linux build) into bin/yt-dlp for YouTube
 * link import (src/lib/import/youtube.ts), pinned to one release and checked
 * against that release's published SHA-256. A mismatch fails the build rather
 * than ship an unverified binary.
 *
 * Linux x64 only (Vercel's functions); elsewhere it does nothing, and YouTube
 * import reports itself unavailable.
 *
 * To update: change VERSION and SHA256 from the release's SHA2-256SUMS
 * (https://github.com/yt-dlp/yt-dlp/releases), line "yt-dlp_linux".
 *
 * Run: node scripts/fetch-ytdlp.mjs (from `npm run build`)
 */
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const VERSION = '2026.08.19';
const SHA256 = '58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a';
const URL_ = `https://github.com/yt-dlp/yt-dlp/releases/download/${VERSION}/yt-dlp_linux`;

const root = path.resolve(import.meta.dirname, '..');
const target = path.join(root, 'bin', 'yt-dlp');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

if (process.platform !== 'linux' || process.arch !== 'x64') {
  console.log(`[yt-dlp] ${process.platform}/${process.arch}: skipped (only bundled for Linux x64).`);
  process.exit(0);
}

if (existsSync(target) && sha(await readFile(target)) === SHA256) {
  console.log(`[yt-dlp] ${VERSION} already present and verified.`);
  process.exit(0);
}

const res = await fetch(URL_);
if (!res.ok) {
  console.error(`[yt-dlp] download failed: HTTP ${res.status}`);
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
const got = sha(buf);
if (got !== SHA256) {
  console.error(`[yt-dlp] checksum mismatch: expected ${SHA256}, got ${got}. Refusing to use it.`);
  process.exit(1);
}
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, buf);
await chmod(target, 0o755);
console.log(`[yt-dlp] ${VERSION} fetched and verified (${(buf.length / 1e6).toFixed(1)} MB).`);
