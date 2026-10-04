# Flipcast roadmap

Where Flipcast stands, how to switch on the parts that need accounts, and
what comes next. Updated 2026-10-04. Git history has the earlier versions.

## How it works

Everything heavy runs **in the user's browser**: decoding and encoding
(FFmpeg WASM), face and person detection (MediaPipe), speech-to-text (Whisper
via transformers.js) and clip finding. The server only does accounts, quota,
job records and billing. So hosting stays near $0, there is no render queue,
and "your video never leaves your device" is literally true.

- **Hosting**: Vercel project `flipcast` (Hobby), domain flipcast.dev.
- **Database**: Neon Postgres via Drizzle. Production migrations run during the
  production build (`scripts/migrate-production.mjs`); a failed migration fails
  the build and leaves the previous deployment live. Keep migrations additive.
- **Big static files** (engine binaries, fonts, models, demo clips) load from
  jsDelivr, pinned by version and commit, with the copies in `/public` as
  fallback (`src/lib/asset-cdn.ts`, checked by `npm run verify:cdn`).

## Shipped

**Making clips**
- 9:16, 1:1 and 16:9 from one source in one pass, sized to the source.
- Framing: centre, manual, or Auto-track (follows the speaker), with split
  screen in the 9:16 cut while two people are on camera.
- Captions: word-by-word, five styles, any language Whisper detects (the
  language is detected on the device; transformers.js would otherwise force
  English), a font per script, an .srt file, and **editable before rendering**.
- Clip finding: ranked **on the device** by hook, clean start and end, pacing,
  focus and length (`src/lib/clips/local.ts`). Optional AI picks through Vercel
  AI Gateway when `CLIP_FINDING_ENABLED=1`, falling back to on-device.
- **Render all ticked clips** in one go, each with its own job and quota.
- Import from Dropbox, Google Drive or direct links (not YouTube; see below).

**Accounts, billing, publishing**
- Email and password accounts (Better Auth); password reset once email is set up.
- Plans: Free 60 min/month (videos up to 10 min), Creator 5 h, Agency 25 h.
  Quota is reserved up front and refunded on failure or cancel.
- Stripe checkout and webhook are built. **The live site refuses Stripe test
  mode**, so paid plans show "Coming soon" until live keys are set.
- Publishing and scheduling to YouTube and TikTok are built and switched off
  (need the platforms' apps; see below).

**Running it**
- `/admin` (emails in `ADMIN_EMAILS`): users, activation, week-1 return,
  renders and failures, Auto-track use, sign-ups by source (`?ref=` /
  `?utm_source=` and referring site), and errors from users' browsers.
- Search: sitemap, robots, social preview image, `/opus-clip-alternative` and
  `/podcast-clip-maker`.

**Tests**: `npm run verify` (geometry, expressions, probing, planning,
tracking, layout, captions, clips, render), plus `verify:billing`,
`verify:social`, `verify:import` and `verify:cdn`.

## Switching on the parts that need accounts

| What | What to set (Vercel, Production) | Notes |
|---|---|---|
| Paid plans | Remove the test-mode Stripe Marketplace integration, then run `STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-setup.mjs https://flipcast.dev` and set the `STRIPE_*` values it prints | Restricted live key recommended. Vercel's Hobby plan is non-commercial: move to Pro (or another host) once charging |
| Password reset | `RESEND_API_KEY`, `AUTH_EMAIL_FROM` | Resend free tier; verify the flipcast.dev sending domain |
| AI clip picks (optional) | `CLIP_FINDING_ENABLED=1` | Needs AI Gateway credit; on-device picks work without it |
| YouTube publishing | `SOCIAL_TOKEN_KEY`, `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | Google Cloud app with YouTube Data API v3; redirect `https://flipcast.dev/api/social/youtube/callback`; uploads stay private until Google audits the app |
| TikTok publishing | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | Login Kit + Content Posting API; redirect `https://flipcast.dev/api/social/tiktok/callback`; posts stay private until TikTok's audit (weeks) |
| TikTok scheduling | `SOCIAL_SCHEDULER_ENABLED=1`, `CRON_SECRET`, storage for waiting clips | Built on Vercel Blob plus a 5-minute cron, which needs Vercel Pro. Free route not built yet: S3-compatible storage (Backblaze B2 or Cloudflare R2) and an external cron (cron-job.org) |

## Known limits

- Speed depends on the user's device; an old laptop renders slowly.
- The free plan caps a video at 10 minutes, which rules out full podcast
  episodes until paid plans open (or the cap is raised).
- Files are processed in the browser, up to 400 MB.
- Auto-track needs a video the browser can decode; otherwise it centres.
- A batch reads the whole source once per clip, so long sources batch slowly.
- No YouTube link import: YouTube's terms forbid downloading, and it would put
  the YouTube publishing approval at risk. Under consideration (see below).

## Next

1. **Decide the free video length** (currently 10 minutes).
2. **YouTube link import**: decided to build like Opus Clip. Blocked on a test
   of whether YouTube allows downloads from cloud servers (`yt-dlp`, needs a
   permission rule to run here); may need the Oracle server and proxies.
3. **Daily posting** for Flipcast's own accounts through Buffer's MCP server.
4. **Brand kit**: saved logo overlay, caption colours and font (a reason to pay).
5. **Faster rendering** with WebCodecs (hardware encoding).
6. **Batch speed**: load the source into the engine once per batch.
7. **Re-download past renders** (today history keeps metadata only).
8. **Oracle server** (deferred): only if YouTube import or long renders need a
   server. Free ARM capacity was unavailable last time.
