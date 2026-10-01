# Flipcast

Turn one horizontal master into platform-ready **9:16, 1:1 and 16:9** cuts — all
rendered in your browser.

The differentiator, stated up front: **your footage never leaves your device.**
There is no upload, no render queue, and no cloud transcoder. FFmpeg runs as
WebAssembly in the page, so the free tier costs us effectively nothing, works
offline once loaded, and cannot leak your source footage.

## Why browser-side rendering

Opus Clip, Captions and Descript all upload to a cloud queue. That model needs
render compute, object storage, upload bandwidth and upload time before you see
a single frame. We rejected it: a browser already has a full video encoder
built in, and FFmpeg WASM removes every one of those dependencies.

The honest trade-off: WASM encoding runs roughly **8x slower than realtime** on a
short clip, so a 60-second master can take several minutes. We show real progress
and say so in the UI rather than hiding it. The multi-threaded core is used
automatically when the browser is cross-origin isolated (the app ships the
required COOP/COEP headers) and the device has 4+ cores.

## Features that work

- **Real dual-format output.** One job produces any combination of 9:16, 1:1 and
  16:9 from the same source. Each is stored as its own `job_outputs` row.
- **Framing via dimension-free crop expressions.** `src/lib/video/geometry.ts`
  emits an FFmpeg `crop=` expression that derives geometry from the stream
  itself, so there is no ffprobe round-trip and no chance of cropping against a
  stale dimension assumption. Verified against real ffmpeg across 4K, portrait,
  square and odd sizes.
- **Codec-independent probing.** Duration and dimensions come from parsing the
  MP4/MOV container directly, so files the browser *cannot decode* (H.264 on
  builds without proprietary codecs) are still measurable — and still renderable,
  because WASM does not care.
- **Enforced free-tier quota.** 180 seconds of source per month. Quota is
  *reserved atomically* before a render starts and refunded if it fails, so
  concurrent tabs cannot collectively overspend it.
- **Better Auth + better-auth-ui.** Real sign-up, sign-in, sessions, password
  reset and account management.

## Not built yet

- **Payments are a stub.** The upgrade button does nothing; no Stripe call is
  made. The free tier is genuinely enforced in the meantime.
- **"Smart Face Track" renders centred.** The mode exists in the UI and is
  clearly labelled as preview; no face-detection model is wired up.
- **No render history playback.** Past jobs are listed with their metadata, but
  the video bytes were never stored, so old outputs cannot be re-downloaded —
  only re-rendered.

## Stack

- Next.js 15, React 19, TypeScript, Tailwind CSS
- FFmpeg WASM (`@ffmpeg/ffmpeg`) — cores self-hosted in `public/ffmpeg`
- Better Auth (`src/lib/auth.ts`) + `@daveyplate/better-auth-ui`
- Drizzle ORM + Postgres (Neon in prod, `docker compose up -d` locally)

## Structure

```
├── drizzle/                      # generated SQL migrations
├── scripts/
│   ├── sync-ffmpeg-core.mjs      # copies wasm cores + ESM wrapper into public/
│   ├── verify-geometry.mjs       # crop math vs real ffmpeg
│   ├── verify-expr.mjs           # dimension-free filter expressions
│   ├── verify-probe.mjs          # container parser vs ffmpeg metadata
│   ├── verify-render.mjs         # real Chromium render, verified by ffmpeg
│   └── verify-e2e.mjs            # full signup -> render -> quota flow
├── public/ffmpeg/                # ~63 MB, gitignored, regenerated on install
└── src/
    ├── db/schema.ts              # user/session/account + video_jobs + job_outputs
    ├── lib/auth.ts               # Better Auth server instance
    ├── lib/quotas.ts             # tier limits, max sizes, formatting
    ├── lib/usage.ts              # atomic quota reservation / refund
    ├── lib/video/geometry.ts     # pure crop math (no Node, no DOM)
    ├── lib/video/ffmpeg-client.ts# render engine
    ├── lib/video/ffmpeg-loader.ts# unbundled wrapper loader (see note below)
    ├── lib/video/probe.ts        # MP4/MOV container metadata parser
    └── components/flipcast/      # dashboard + auth panel
```

### Why the ffmpeg wrapper is served unbundled

`@ffmpeg/ffmpeg`'s worker loads the WASM core with `await import(coreURL)`.
Webpack statically rewrites that into a build-time module lookup, which cannot
resolve a public path (`Cannot find module '/ffmpeg/0.12.10/ffmpeg-core.js'`) or
a blob URL (`Cannot find module 'blob:...'`). There is no build-time warning; the
render simply fails at runtime.

`scripts/sync-ffmpeg-core.mjs` therefore also copies the wrapper's ESM build to
`public/ffmpeg/lib`, and `ffmpeg-loader.ts` imports it through an `eval`-scoped
`import()` that the bundler leaves alone. `public/` is excluded from
`tsconfig.json` so the vendored `.d.ts` files are not type-checked.

## Setup

```bash
npm install                 # postinstall syncs the wasm cores into public/
docker compose up -d        # local Postgres
cp .env.example .env.local  # set DATABASE_URL + BETTER_AUTH_SECRET
npm run db:migrate
npm run dev                 # http://localhost:3000
```

## Verification

```bash
npm run verify:geometry   # crop math, 9 cases
npm run verify:expr       # filter expressions, 21 cases
npm run verify:probe      # container parsing vs ffmpeg metadata
npm run verify:render     # real browser render, output checked by ffmpeg
npm run verify:e2e        # full flow (needs a server on :3100)
```

`verify:render` and `verify:e2e` need `ffmpeg-static`, whose postinstall script
npm 12 blocks by default. If the binary is missing:

```bash
cd node_modules/ffmpeg-static && node install.js
```

## License

MIT