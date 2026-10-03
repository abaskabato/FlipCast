/**
 * Encryption for stored OAuth tokens, and signing for OAuth `state`.
 *
 * Tokens: AES-256-GCM with a random 96-bit IV per value and the auth tag
 * checked on decrypt, so a tampered or swapped value fails loudly instead of
 * decrypting to garbage. The key (SOCIAL_TOKEN_KEY, 32 bytes, base64) lives
 * only in the environment.
 *
 * State: an HMAC-SHA256-signed, expiring payload naming the user and
 * platform, plus a nonce that must also match a cookie set on the same
 * browser, so a callback cannot be replayed into someone else's session.
 *
 * Node only.
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';

const b64u = (b: Buffer) => b.toString('base64url');
const fromB64u = (s: string) => Buffer.from(s, 'base64url');

function tokenKey(): Buffer {
  const raw = process.env.SOCIAL_TOKEN_KEY?.trim();
  if (!raw) throw new Error('SOCIAL_TOKEN_KEY is not set.');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('SOCIAL_TOKEN_KEY must be 32 bytes, base64 encoded.');
  return key;
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', tokenKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, b64u(iv), b64u(cipher.getAuthTag()), b64u(ct)].join(':');
}

export function decryptToken(sealed: string): string {
  const [v, iv, tag, ct] = sealed.split(':');
  if (v !== VERSION || !iv || !tag || ct === undefined) throw new Error('Unrecognised token format.');
  const decipher = createDecipheriv('aes-256-gcm', tokenKey(), fromB64u(iv));
  decipher.setAuthTag(fromB64u(tag));
  return Buffer.concat([decipher.update(fromB64u(ct)), decipher.final()]).toString('utf8');
}

// ---- OAuth state -----------------------------------------------------------

type StatePayload = { u: string; p: string; n: string; e: number };

function stateKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error('BETTER_AUTH_SECRET is not set.');
  // Derived, so the state key is never the session-signing key itself.
  return createHmac('sha256', secret).update('flipcast-social-oauth-state').digest();
}

/** A signed state value and the nonce to store in a cookie alongside it. */
export function createState(userId: string, platform: string, ttlMs = 10 * 60_000): { state: string; nonce: string } {
  const nonce = b64u(randomBytes(16));
  const payload: StatePayload = { u: userId, p: platform, n: nonce, e: Date.now() + ttlMs };
  const body = b64u(Buffer.from(JSON.stringify(payload)));
  const sig = b64u(createHmac('sha256', stateKey()).update(body).digest());
  return { state: `${body}.${sig}`, nonce };
}

/** The verified payload, or null if the signature, expiry, nonce or user do not match. */
export function verifyState(
  state: string,
  expected: { nonce: string | undefined; userId: string; platform: string },
): StatePayload | null {
  const [body, sig] = state.split('.');
  if (!body || !sig || !expected.nonce) return null;
  const want = createHmac('sha256', stateKey()).update(body).digest();
  const got = fromB64u(sig);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let payload: StatePayload;
  try {
    payload = JSON.parse(fromB64u(body).toString('utf8'));
  } catch {
    return null;
  }
  if (payload.e < Date.now()) return null;
  if (payload.n !== expected.nonce || payload.u !== expected.userId || payload.p !== expected.platform) return null;
  return payload;
}
