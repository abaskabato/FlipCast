/**
 * Verifies publishing to YouTube and TikTok against local stand-ins for both
 * platforms and a local Postgres:
 *
 *  - stored tokens are encrypted, tamper-evident and need the right key;
 *  - OAuth state is bound to user, platform, browser nonce and expiry;
 *  - TikTok chunk plans follow TikTok's rules for every size;
 *  - connecting stores accounts with encrypted tokens, reconnecting updates
 *    the same row, and expiring tokens are refreshed and stored;
 *  - a revoked Google refresh token asks the user to reconnect;
 *  - YouTube upload sessions carry the size, type, origin and a private
 *    status with publishAt when scheduled;
 *  - TikTok checks the creator's privacy options and sends the chunk plan;
 *  - the scheduler streams a due clip to TikTok byte-exact at the planned
 *    ranges, records processing, then posted, and deletes the stored clip;
 *    overlapping runs send it once; failures retry, then give up.
 *
 * Needs a throwaway database, never production:
 *   SOCIAL_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/flipcast_test npm run verify:social
 * (migrated with: DATABASE_URL=<same> npx drizzle-kit migrate)
 */
import http from 'node:http';
import { randomBytes } from 'node:crypto';

const dbUrl = process.env.SOCIAL_TEST_DATABASE_URL;
if (!dbUrl || !['127.0.0.1', 'localhost'].includes(new URL(dbUrl).hostname)) {
  console.error('Refusing to run: SOCIAL_TEST_DATABASE_URL must point at a local throwaway database.');
  process.exit(2);
}

let failed = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
};
const throws = async (fn) => {
  try { await fn(); return null; } catch (e) { return e; }
};

// ---- stand-ins for Google and TikTok ---------------------------------------------
const seen = { requests: [], chunks: [], tiktokStatus: 'PROCESSING_UPLOAD', refreshGrant: 'ok', putFail: 0 };
const server = http.createServer((req, res) => {
  const parts = [];
  req.on('data', (c) => parts.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(parts);
    const url = new URL(req.url, 'http://x');
    const json = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    const form = () => Object.fromEntries(new URLSearchParams(raw.toString()));
    seen.requests.push({ method: req.method, path: url.pathname, headers: req.headers, body: raw });

    if (url.pathname === '/token') {
      const f = form();
      if (f.grant_type === 'refresh_token' && seen.refreshGrant === 'revoked') return json(400, { error: 'invalid_grant' });
      return json(200, { access_token: `g-access-${f.grant_type}`, refresh_token: f.grant_type === 'authorization_code' ? 'g-refresh' : undefined, expires_in: 3600, scope: 'youtube.upload' });
    }
    if (url.pathname === '/youtube/v3/channels') return json(200, { items: [{ id: 'UC123', snippet: { title: 'My Channel', thumbnails: { default: { url: 'https://img/ch.png' } } } }] });
    if (url.pathname === '/upload/youtube/v3/videos') return json(200, {}, { location: 'https://upload.example/session/abc' });
    if (url.pathname === '/v2/oauth/token/') {
      const f = form();
      return json(200, { access_token: `t-access-${f.grant_type}`, refresh_token: 't-refresh-2', expires_in: 86400, open_id: 'open-1', scope: 'user.info.basic,video.publish' });
    }
    if (url.pathname === '/v2/user/info/') return json(200, { data: { user: { open_id: 'open-1', display_name: 'tik creator', avatar_url: 'https://img/t.png' } }, error: { code: 'ok' } });
    if (url.pathname === '/v2/post/publish/creator_info/query/') {
      return json(200, { data: { creator_nickname: 'tik creator', creator_username: 'tikc', creator_avatar_url: '', privacy_level_options: ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'], comment_disabled: false, duet_disabled: true, stitch_disabled: false, max_video_post_duration_sec: 600 }, error: { code: 'ok' } });
    }
    if (url.pathname === '/v2/post/publish/video/init/') {
      seen.init = JSON.parse(raw.toString());
      return json(200, { data: { publish_id: 'pub-1', upload_url: `http://127.0.0.1:${server.address().port}/tiktok-upload` }, error: { code: 'ok' } });
    }
    if (url.pathname === '/tiktok-upload' && req.method === 'PUT') {
      if (seen.putFail > 0) { seen.putFail--; res.writeHead(500); return res.end(); }
      seen.chunks.push({ range: req.headers['content-range'], length: Number(req.headers['content-length']), type: req.headers['content-type'], body: raw });
      res.writeHead(206); return res.end();
    }
    if (url.pathname === '/v2/post/publish/status/fetch/') return json(200, { data: { status: seen.tiktokStatus }, error: { code: 'ok' } });
    res.writeHead(404); res.end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

Object.assign(process.env, {
  DATABASE_URL: dbUrl,
  SOCIAL_TOKEN_KEY: randomBytes(32).toString('base64'),
  BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
  BETTER_AUTH_URL: 'https://flipcast.test',
  YOUTUBE_CLIENT_ID: 'yt-id', YOUTUBE_CLIENT_SECRET: 'yt-secret',
  TIKTOK_CLIENT_KEY: 'tt-key', TIKTOK_CLIENT_SECRET: 'tt-secret',
  GOOGLE_AUTH_BASE: base, GOOGLE_TOKEN_BASE: base, YOUTUBE_API_BASE: base, TIKTOK_AUTH_BASE: base, TIKTOK_API_BASE: base,
});
delete process.env.DATABASE_URL_POOLED;

const crypto = await import('../src/lib/social/crypto.ts');
const tiktok = await import('../src/lib/social/tiktok.ts');
const youtube = await import('../src/lib/social/youtube.ts');
const store = await import('../src/lib/social/store.ts');
const { runScheduler } = await import('../src/lib/social/scheduler.ts');
const { db, pool } = await import('../src/db/index.ts');
const schema = await import('../src/db/schema.ts');
const { eq } = await import('drizzle-orm');

try {
  // ---- crypto -------------------------------------------------------------------
  const sealed = crypto.encryptToken('secret-token');
  check(crypto.decryptToken(sealed) === 'secret-token' && !sealed.includes('secret-token'), 'tokens round-trip and are not stored in the clear');
  const [v, iv, tag, ct] = sealed.split(':');
  const flipped = [v, iv, tag, Buffer.from(Buffer.from(ct, 'base64url').map((b, i) => (i === 0 ? b ^ 1 : b))).toString('base64url')].join(':');
  check(!!(await throws(() => crypto.decryptToken(flipped))), 'a tampered token fails to decrypt');
  const realKey = process.env.SOCIAL_TOKEN_KEY;
  process.env.SOCIAL_TOKEN_KEY = randomBytes(32).toString('base64');
  check(!!(await throws(() => crypto.decryptToken(sealed))), 'a different key cannot decrypt');
  process.env.SOCIAL_TOKEN_KEY = realKey;

  const { state, nonce } = crypto.createState('user-1', 'youtube');
  const ok = (o) => crypto.verifyState(state, { nonce, userId: 'user-1', platform: 'youtube', ...o });
  check(!!ok({}), 'OAuth state verifies for the same user, platform and browser');
  check(!ok({ nonce: 'other' }) && !ok({ userId: 'user-2' }) && !ok({ platform: 'tiktok' }) && !ok({ nonce: undefined }),
    'state is refused for another browser, user or platform');
  // Change the signed payload (user u -> v), keeping the old signature.
  const [body, sig] = state.split('.');
  const forged = Buffer.from(Buffer.from(body, 'base64url').toString().replace('user-1', 'user-2')).toString('base64url');
  check(!crypto.verifyState(`${forged}.${sig}`, { nonce, userId: 'user-2', platform: 'youtube' }), 'a forged state payload is refused');
  const old = crypto.createState('user-1', 'youtube', -1);
  check(!crypto.verifyState(old.state, { nonce: old.nonce, userId: 'user-1', platform: 'youtube' }), 'an expired state is refused');

  // ---- chunk plans ------------------------------------------------------------------
  const MB = 1024 * 1024;
  let plansOk = true;
  for (const size of [1, 3 * MB, 5 * MB - 1, 5 * MB, 10 * MB, 25 * MB + 7, 64 * MB, 399 * MB + 123]) {
    const p = tiktok.chunkPlan(size);
    const covered = p.ranges.reduce((n, [a, b]) => n + (b - a + 1), 0);
    const contiguous = p.ranges.every(([a], i) => (i === 0 ? a === 0 : a === p.ranges[i - 1][1] + 1));
    const sizes = p.ranges.map(([a, b]) => b - a + 1);
    const rules = p.totalChunks === 1
      ? p.chunkSize === size && size <= 64 * MB
      : p.totalChunks === Math.floor(size / p.chunkSize) && sizes.slice(0, -1).every((s) => s >= 5 * MB && s <= 64 * MB) && sizes.at(-1) <= 128 * MB && sizes.at(-1) >= 5 * MB;
    if (!(covered === size && contiguous && rules && p.totalChunks <= 1000)) { plansOk = false; console.log('  bad plan for', size, p.totalChunks, sizes); }
  }
  check(plansOk, 'chunk plans cover every byte and follow TikTok size rules');

  // ---- YouTube ----------------------------------------------------------------------
  check(youtube.youtubeAuthUrl('S').includes('access_type=offline') && youtube.youtubeAuthUrl('S').includes(encodeURIComponent('https://flipcast.test/api/social/youtube/callback')),
    'YouTube consent asks for offline access and returns to our callback');
  const scheduledRes = youtube.youtubeVideoResource({ title: 'T', description: 'D', privacy: 'public', publishAt: '2030-01-01T10:00:00.000Z', sizeBytes: 1, contentType: 'video/mp4' });
  check(scheduledRes.status.privacyStatus === 'private' && scheduledRes.status.publishAt === '2030-01-01T10:00:00.000Z', 'a scheduled YouTube video is private with publishAt');

  await db.insert(schema.user).values({ id: 'user-1', email: 'u1@test.local' }).onConflictDoNothing();
  const ytTokens = await youtube.youtubeExchangeCode('code-1');
  const ch = await youtube.youtubeChannel(ytTokens.accessToken);
  const yt = await store.saveAccount({ userId: 'user-1', platform: 'youtube', externalId: ch.id, displayName: ch.title, avatarUrl: ch.avatarUrl, tokens: ytTokens });
  const [rawRow] = await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, yt.id));
  check(rawRow.displayName === 'My Channel' && !rawRow.accessTokenEnc.includes('g-access') && !rawRow.refreshTokenEnc.includes('g-refresh'),
    'connecting stores the channel with encrypted tokens');
  const again = await store.saveAccount({ userId: 'user-1', platform: 'youtube', externalId: 'UC123', displayName: 'Renamed', avatarUrl: null, tokens: { ...ytTokens, refreshToken: null } });
  const rows = await store.listAccounts('user-1');
  check(again.id === yt.id && rows.length === 1 && crypto.decryptToken(again.refreshTokenEnc) === 'g-refresh', 'reconnecting updates the same account and keeps the refresh token');

  await db.update(schema.socialAccounts).set({ accessTokenExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.socialAccounts.id, yt.id));
  const token = await store.accessTokenFor((await store.getAccount('user-1', yt.id)));
  const [afterRefresh] = await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, yt.id));
  check(token === 'g-access-refresh_token' && afterRefresh.accessTokenExpiresAt > new Date(), 'an expired token is refreshed and the new one stored');

  await db.update(schema.socialAccounts).set({ accessTokenExpiresAt: new Date(0) }).where(eq(schema.socialAccounts.id, yt.id));
  seen.refreshGrant = 'revoked';
  const revoked = await throws(async () => store.accessTokenFor(await store.getAccount('user-1', yt.id)));
  check(revoked?.reconnect === true, 'a revoked Google grant asks the user to reconnect');
  seen.refreshGrant = 'ok';

  seen.requests.length = 0;
  const session = await youtube.youtubeUploadSession('tok', { title: 'Clip', description: '', privacy: 'unlisted', publishAt: null, sizeBytes: 12345, contentType: 'video/mp4' }, 'https://flipcast.test');
  const sessReq = seen.requests.find((r) => r.path === '/upload/youtube/v3/videos');
  check(session === 'https://upload.example/session/abc' && sessReq.headers['x-upload-content-length'] === '12345' && sessReq.headers.origin === 'https://flipcast.test'
    && JSON.parse(sessReq.body).status.privacyStatus === 'unlisted', 'YouTube upload session carries size, origin and privacy');

  // ---- TikTok -----------------------------------------------------------------------
  const ttTokens = await tiktok.tiktokExchangeCode('code-2');
  const tu = await tiktok.tiktokUser(ttTokens.accessToken);
  const tt = await store.saveAccount({ userId: 'user-1', platform: 'tiktok', externalId: ttTokens.openId, displayName: tu.displayName, avatarUrl: tu.avatarUrl, tokens: ttTokens });
  const opts = { title: 'Hi', privacy: 'PUBLIC_TO_EVERYONE', disableComment: false, disableDuet: false, disableStitch: false, brandContent: false, brandOrganic: true };
  const badPrivacy = await throws(() => tiktok.tiktokInitUpload('tok', { ...opts, privacy: 'FOLLOWER_OF_CREATOR' }, 1000));
  check(badPrivacy?.status === 422, "a privacy level the creator does not offer is refused before posting");
  const init = await tiktok.tiktokInitUpload('tok', opts, 25 * MB + 7);
  check(init.publishId === 'pub-1' && seen.init.source_info.total_chunk_count === 2 && seen.init.source_info.chunk_size === 10 * MB
    && seen.init.post_info.disable_duet === true && seen.init.post_info.brand_organic_toggle === true,
    'TikTok init sends the chunk plan, the post settings and honours the creator\'s duet setting');

  // ---- scheduler ----------------------------------------------------------------------
  const clip = randomBytes(25 * MB + 7);
  const blobs = new Map([['scheduled/user-1/clip.mp4', clip]]);
  const removed = [];
  const clipStore = {
    open: async (p) => {
      const data = blobs.get(p);
      if (!data) return null;
      // Odd-sized pieces, to prove chunk boundaries do not depend on them.
      let off = 0;
      const stream = new ReadableStream({ pull(c) { if (off >= data.length) return c.close(); const n = Math.min(777_777, data.length - off); c.enqueue(new Uint8Array(data.subarray(off, off + n))); off += n; } });
      return { stream, size: data.length, contentType: 'video/mp4' };
    },
    remove: async (p) => { removed.push(p); blobs.delete(p); },
  };
  const post = await store.createPost({ userId: 'user-1', socialAccountId: tt.id, platform: 'tiktok', status: 'scheduled', scheduledAt: new Date(Date.now() - 60_000), title: 'Scheduled clip', privacy: 'PUBLIC_TO_EVERYONE', options: JSON.stringify(opts), blobPathname: 'scheduled/user-1/clip.mp4' });
  const later = await store.createPost({ userId: 'user-1', socialAccountId: tt.id, platform: 'tiktok', status: 'scheduled', scheduledAt: new Date(Date.now() + 3600_000), title: 'Later', privacy: 'SELF_ONLY', options: JSON.stringify(opts), blobPathname: 'scheduled/user-1/later.mp4' });

  seen.chunks.length = 0;
  const [r1, r2] = await Promise.all([runScheduler(clipStore), runScheduler(clipStore)]);
  const joined = Buffer.concat(seen.chunks.map((c) => c.body));
  check(r1.sent.length + r2.sent.length === 1 && seen.chunks.length === 2, 'overlapping scheduler runs send a due post exactly once');
  check(seen.chunks[0].range === `bytes 0-${10 * MB - 1}/${clip.length}` && seen.chunks[1].range === `bytes ${10 * MB}-${clip.length - 1}/${clip.length}` && seen.chunks.every((c) => c.length === c.body.length),
    'chunks are sent at the planned ranges with matching lengths');
  check(joined.equals(clip), 'TikTok receives the stored clip byte for byte');
  check((await store.getPost('user-1', post.id)).status === 'processing' && (await store.getPost('user-1', later.id)).status === 'scheduled',
    'the due post moves to processing; a later one waits');

  seen.tiktokStatus = 'PUBLISH_COMPLETE';
  const r3 = await runScheduler(clipStore);
  check(r3.posted.includes(post.id) && (await store.getPost('user-1', post.id)).status === 'posted' && removed.includes('scheduled/user-1/clip.mp4'),
    'once TikTok publishes it, the post is marked posted and the stored clip deleted');

  // Failures: retry twice, then give up and delete the clip.
  blobs.set('scheduled/user-1/flaky.mp4', randomBytes(3 * MB));
  const flaky = await store.createPost({ userId: 'user-1', socialAccountId: tt.id, platform: 'tiktok', status: 'scheduled', scheduledAt: new Date(Date.now() - 1000), title: 'Flaky', privacy: 'SELF_ONLY', options: JSON.stringify(opts), blobPathname: 'scheduled/user-1/flaky.mp4' });
  seen.putFail = 99;
  await runScheduler(clipStore);
  const afterOne = await store.getPost('user-1', flaky.id);
  check(afterOne.status === 'scheduled' && afterOne.attempts === 1 && /rejected/.test(afterOne.error), 'a failed send is retried on the next run');
  await runScheduler(clipStore);
  await runScheduler(clipStore);
  const afterThree = await store.getPost('user-1', flaky.id);
  check(afterThree.status === 'failed' && afterThree.attempts === 3 && removed.includes('scheduled/user-1/flaky.mp4'), 'after three failures it gives up and deletes the stored clip');
  seen.putFail = 0;

  const listed = await store.listPosts('user-1');
  check(listed.length === 3 && listed.every((p) => p.accountName === 'tik creator'), 'posts list with their account name');
} catch (e) {
  check(false, `unexpected error: ${e.stack}`);
} finally {
  await db.delete(schema.user).where(eq(schema.user.id, 'user-1')).catch(() => undefined);
  await pool.end();
  server.close();
}

console.log(failed ? `\nSOCIAL: ${failed} FAILED` : '\nSOCIAL: ALL PASS');
process.exit(failed ? 1 : 0);
