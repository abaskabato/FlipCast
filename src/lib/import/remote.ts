/**
 * Server side of "import from link": fetch one byte range of a public video
 * file and hand it straight back. Nothing is stored.
 *
 * Why ranges: a Vercel Function response is capped at 4.5 MB, so the browser
 * assembles the file from pieces of at most {@link MAX_CHUNK} bytes. Hosts
 * that allow cross-origin requests skip this entirely (see import/client.ts).
 *
 * Why the address checks: a server that fetches any URL a user gives it can
 * be pointed at internal networks and cloud metadata endpoints. Every address
 * is checked when the socket connects (so DNS rebinding cannot swap in a
 * private address after the check), and every redirect is re-validated.
 *
 * Node only.
 */

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/** Largest piece returned per request: under the 4.5 MB response cap. */
export const MAX_CHUNK = 4 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 20_000;

export class ImportError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ImportError';
    this.status = status;
  }
}

/** True for addresses a public file host can never legitimately be. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      a >= 224 // multicast and reserved
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPrivateAddress(mapped[1]);
    return (
      v === '::' ||
      v === '::1' ||
      v.startsWith('fc') ||
      v.startsWith('fd') || // unique local
      /^fe[89ab]/.test(v) || // link-local
      v.startsWith('ff') // multicast
    );
  }
  return true;
}

/** Only plain web URLs on standard ports, with no credentials in them. */
export function validateUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImportError('That is not a valid link.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ImportError('Only http and https links work.');
  if (url.username || url.password) throw new ImportError('Links with a username or password are not supported.');
  if (url.port && url.port !== '80' && url.port !== '443') throw new ImportError('Links on unusual ports are not supported.');
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, '')) && isPrivateAddress(url.hostname.replace(/^\[|\]$/g, ''))) {
    throw new ImportError('That address is not reachable from here.');
  }
  return url;
}

/** DNS lookup that refuses to connect to a private address. */
const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 4);
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || list.length === 0) {
      return callback(new ImportError('That address is not reachable from here.'), '', 4);
    }
    if ((options as dns.LookupOptions).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

type Piece = { body: Buffer; total: number | null; contentType: string; start: number; end: number };

/** One GET with a Range header, following redirects; resolves with at most MAX_CHUNK bytes. */
function getRange(url: URL, start: number, end: number, redirects = 0): Promise<Piece> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.get(
      url,
      {
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
        headers: { Range: `bytes=${start}-${end}`, 'User-Agent': 'Flipcast-Import/1.0', Accept: 'video/*,*/*;q=0.5' },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirects >= MAX_REDIRECTS) return reject(new ImportError('That link redirects too many times.'));
          try {
            const next = validateUrl(new URL(res.headers.location, url).toString());
            return resolve(getRange(next, start, end, redirects + 1));
          } catch (e) {
            return reject(e);
          }
        }
        if (status === 416) {
          res.resume();
          return reject(new ImportError('The file is shorter than expected.'));
        }
        if (status !== 206 && status !== 200) {
          res.resume();
          return reject(new ImportError(`The link answered with an error (${status}). Is the file shared publicly?`, 502));
        }
        const contentType = String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
        if (contentType.startsWith('text/html')) {
          res.resume();
          return reject(
            new ImportError('That link opens a web page, not a video file. Use a direct or shared download link.', 422),
          );
        }
        // 206: Content-Range "bytes a-b/total". 200: the host ignored Range and
        // sent the whole file, which is only usable if it fits in one piece.
        let total: number | null = null;
        let gotStart = start;
        if (status === 206) {
          const m = /bytes (\d+)-(\d+)\/(\d+|\*)/.exec(String(res.headers['content-range'] ?? ''));
          if (m) {
            gotStart = Number(m[1]);
            total = m[3] === '*' ? null : Number(m[3]);
          }
        } else {
          const len = Number(res.headers['content-length']);
          total = Number.isFinite(len) ? len : null;
          if (start !== 0 || total === null || total > MAX_CHUNK) {
            res.resume();
            return reject(
              new ImportError('That host does not allow partial downloads, so the file cannot be imported. Download it and upload the file instead.', 422),
            );
          }
        }
        const parts: Buffer[] = [];
        let size = 0;
        res.on('data', (b: Buffer) => {
          size += b.length;
          if (size > MAX_CHUNK + 1) {
            req.destroy(new ImportError('The host sent more than was asked for.', 502));
            return;
          }
          parts.push(b);
        });
        res.on('end', () => {
          const body = Buffer.concat(parts);
          resolve({ body, total, contentType, start: gotStart, end: gotStart + body.length - 1 });
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new ImportError('The link took too long to answer.', 504)));
    req.on('error', (e) => reject(e instanceof ImportError ? e : new ImportError('Could not reach that link.', 502)));
  });
}

/** Fetch bytes [start, start + MAX_CHUNK) of `rawUrl`. */
export async function fetchPiece(rawUrl: string, start: number): Promise<Piece> {
  if (!Number.isInteger(start) || start < 0) throw new ImportError('Bad range.');
  return getRange(validateUrl(rawUrl), start, start + MAX_CHUNK - 1);
}
