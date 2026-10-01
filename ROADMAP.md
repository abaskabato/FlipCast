# Flipcast Product Roadmap

## 1. Shipped (this commit)

The original spec called for an upload → cloud transcode → download pipeline.
That model is abandoned. **Rendering happens in the user's browser** via FFmpeg
WASM, which removes the compute, storage and bandwidth blockers entirely and
makes "your footage never leaves your device" a real property rather than a
promise.

- **Auth** — Better Auth (email/password, sessions, password reset) on
  `src/lib/auth.ts`, UI from `@daveyplate/better-auth-ui`.
- **DB** — Postgres via Drizzle. `video_jobs` + a new `job_outputs` table with
  one row per rendered format. Migration in `drizzle/0000_launch_schema.sql`.
- **Render engine** — `src/lib/video/ffmpeg-client.ts`, FFmpeg WASM with cores
  self-hosted in `public/ffmpeg`. Multi-threaded core when cross-origin isolated
  and 4+ cores, single-threaded fallback otherwise.
- **Geometry** — dimension-free crop expressions in `src/lib/video/geometry.ts`,
  verified against real ffmpeg.
- **Probing** — MP4/MOV container parser, so files the browser cannot decode are
  still measurable.
- **Quota** — 180 s/month free tier, reserved atomically up front and refunded on
  failure, with monthly rollover.
- **Job API** — `POST/PATCH /api/transform` (authorise + reserve, then record
  terminal state), `GET /api/jobs`, `GET /api/jobs/[id]`, `GET /api/me/usage`.
- **Retired** — `/api/uploads/*` now return an explicit `410` so any stale client
  fails loudly rather than mysteriously. `/api/downloads/[id]` returns `409`
  explaining that local renders have no server-side file.

Verified: `tsc --noEmit` clean, `next build` clean, and five verification suites
green (`verify:geometry`, `verify:expr`, `verify:probe`, `verify:render`,
`verify:e2e`). `verify:e2e` drives a real browser through signup → upload →
render → quota debit against Postgres.

## 2. Honest gaps

1. **Payments are stubbed.** The Upgrade button does nothing; no Stripe call is
   made. Free tier is fully enforced in the meantime.
2. **`smart_face` renders centred.** No face-detection model; labelled as preview
   in the UI rather than silently faking it.
3. **`manual_crop` is not interactive.** The mode is selectable but applies the
   same centred crop; there is no crop UI.
4. **No history playback.** Past jobs list their metadata, but output bytes were
   never stored, so old formats can only be re-rendered.
5. **Speed.** ~8x realtime on a 3 s clip. Mitigated with the MT core and honest
   UI copy, but it is the single biggest UX cost of the browser-render model.

## 3. Next (in order)

1. **Interactive manual crop.** Drag a focal point; persist it and pass an
   offset into `filterExpr`. Highest value, smallest change.
2. **Stripe.** `POST /api/billing/checkout` + webhook, graceful 503 without
   keys, real tier limits in `src/lib/quotas.ts`.
3. **Real face tracking.** Either a small ONNX/WASM detector or per-frame crop
   expressions. Needs a latency budget decision, since it multiplies the filter
   work in the slowest part of the pipeline.
4. **Progress accuracy.** `PATCH /api/transform` currently records terminal
   state only; wire per-output progress so history can show partial renders.
5. **COEP audit.** `require-corp` blocks any third-party embed. Analytics,
   Stripe iframes and OAuth popups will each need an explicit carve-out.
6. **Retention.** Decide whether to store output metadata only (current) or to
   opt users into server-side copies, which reintroduces the storage problem
   browser rendering was chosen to avoid.

## 4. Oracle VM (deferred, not required)

The VM was the original render host and is **no longer on the critical path**.
If it is ever provisioned for other reasons:

- Image `Canonical Ubuntu 24.04 Minimal aarch64`, shape `VM.Standard.A1.Flex`
  (4 OCPU / 24 GB), public subnet, ingress TCP 22/80/443, SSH user `ubuntu`.
- Provisioning was blocked on shape capacity (E2 Micro full; needs A1.Flex with an
  ARM image, AD-2/AD-3).
- It would host Postgres and a `renderEngine: 'worker'` path for long clips,
  which are the one case the browser handles badly.