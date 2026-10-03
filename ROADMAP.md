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

1. **Payments need keys.** `POST /api/billing/checkout` and the webhook handler
   are implemented and type-checked, but with no `STRIPE_SECRET_KEY` checkout
   returns a 503 and the upgrade button explains why. Free tier is fully
   enforced throughout, so nothing is lost while billing is off. The webhook is
   the only writer of `subscription_tier` — the client cannot set it.
2. ~~**`smart_face` renders centred.**~~ Shipped as Auto-track: MediaPipe face
   detection on the device, smoothed into a moving crop (see 3b).
3. **No history playback.** Past jobs list their metadata, but output bytes were
   never stored, so old formats can only be re-rendered.
4. **Speed.** ~8x realtime on a 3 s clip. Mitigated with the MT core and honest
   UI copy, but it is the single biggest UX cost of the browser-render model.
5. **Pricing page figures are aspirational.** `/pricing` shows intended prices;
   the authoritative amount is whatever the Stripe price ID encodes.

## 3. Next (in order)

1. **Turn on billing.** Create the four Stripe prices, set the env vars, register
   the webhook. Everything else in the payment path is already written.
2. **Real face tracking.** Either a small ONNX/WASM detector or per-frame crop
   expressions. Needs a latency budget decision, since it multiplies the filter
   work in the slowest part of the pipeline.
3. **Progress accuracy.** `PATCH /api/transform` currently records terminal
   state only; wire per-output progress so history can show partial renders.
4. **COEP audit.** `require-corp` blocks any third-party embed. Analytics,
   Stripe iframes and OAuth popups will each need an explicit carve-out.
5. **Retention.** Decide whether to store output metadata only (current) or to
   opt users into server-side copies, which reintroduces the storage problem
   browser rendering was chosen to avoid.

## 3a. Shipped since the section above

- **Interactive manual crop.** `filterExpr(ratio, focus)` takes a focal point in
  frame fractions; `FocusPicker` lets the user click or drag it, with arrow-key
  support and a live overlay of the real crop rectangle per selected ratio.
  Verified in `verify:expr` (out-of-bounds focus clamps, centre vs corner must
  differ) and end-to-end in `verify:render` through the actual browser pipeline.
- **Billing endpoints.** `POST /api/billing/checkout` (validated with zod,
  signature-free, redirect URLs derived from `BETTER_AUTH_URL` rather than any
  request header) and `POST /api/billing/webhook` (raw-body signature
  verification, the sole writer of `subscription_tier`).
- **`/pricing` page.** Static, so it cannot fail on a cold serverless start.

## 3b. Competitive pass (2026-10-02)

Benchmarked against Opus Clip, Kapwing, VEED and CapCut. Closed the gaps that
fit the on-device model:

- **Allowances.** Free 60 min/mo (clips up to 10 min), Creator 5 h (30 min),
  Agency 25 h (60 min). Rendering is on the user's device, so minutes cost us
  almost nothing; Creator is about 4 cents a minute against Opus Clip's 10.
- **Auto-track.** `subject-detect.ts` samples frames through a `<video>`
  element and MediaPipe BlazeFace (whole frame plus three overlapping tiles,
  so small faces in wide shots are found). `tracking.ts` rejects false
  detections, bridges gaps, smooths with a zero-phase filter, simplifies with
  RDP and emits a flat piecewise-linear crop expression evaluated per frame.
  Verified by `verify:track` (a moving subject stays centred to the pixel).
- **Auto captions.** Audio is extracted with ffmpeg, transcribed in a worker
  with Whisper base (word timestamps, transformers.js, ~77 MB model cached
  after first use), grouped into short lines per shape and burned in with
  libass in three styles; an .srt is offered too. Verified by
  `verify:captions` against a real libass.

- **Split screen.** When two similar-sized people are on camera together for
  most of a clip and too far apart for one 9:16 window, `layout.ts` stacks a
  crop of each (left speaker on top) in the 9:16 output; other shapes keep the
  tracked crop. Detection falls back to an EfficientDet person detector when
  BlazeFace finds fewer than two faces, which is what makes profile speakers in
  wide podcast shots detectable. Verified by `verify:layout` and on real
  footage (public/demo/twoshot-*).

Not done, deliberately: AI clip selection and scheduled posting. Both need
server-side AI or platform API approvals (TikTok/Meta app review), and the
first would break "your footage never leaves your device".

- **Captions in every script.** `captions/scripts.ts` picks a bold Noto face
  per word (Arabic, Hebrew, Indic, Thai, CJK and more; public/fonts/captions,
  SIL OFL), fetched only when a transcript needs it. CJK and Thai join without
  spaces and break lines by display width. Verified by `verify:captions`
  (glyph coverage and libass fallback for 26 languages) and through the
  in-browser engine.

## 3c. Closing the gaps with Opus Clip (2026-10-03)

- **Layouts switch mid-clip.** `planSplitSegments` returns time stretches; the
  9:16 output shows split screen only while two people are on camera
  (majority vote over neighbouring samples, stretches under 2 s ignored, gaps
  under 1.2 s bridged) and the tracked crop otherwise, in the same ffmpeg pass.
- **Captions.** Two new styles (Reveal, One word) and a pop-in on the spoken
  word; an opt-in "High accuracy" model (Whisper small, 249 MB) next to the
  default base model.
- **Import from a link.** Dropbox and Google Drive share links, and direct
  file links. The browser fetches directly when the host allows it; otherwise
  `/api/import` passes the file through in 4 MB range requests (the Vercel
  response cap), storing nothing, with SSRF checks at connect time. Streaming
  sites (YouTube, TikTok, ...) are refused: their terms forbid downloading.
- **AI clip finding.** Speech is transcribed on the device; only the
  transcript goes to `/api/clips`, which asks Claude (Anthropic SDK through
  Vercel AI Gateway, `anthropic/claude-opus-5.5`, structured output) for
  stand-alone clips by line number. "Use this clip" renders just that stretch,
  with detection limited to it and captions reusing the transcript.

Verified by `verify:layout`, `verify:captions`, `verify:import` and
`verify:clips` (the Claude call against a local stand-in for AI Gateway), and
end to end through the in-browser engine.

### Going live: what needs your accounts

1. **AI Gateway** (clip finding): enable AI Gateway on the Vercel team. The
   deployment authenticates with its OIDC token automatically; AI Gateway needs
   credits or a payment method on file (a 403 `customer_verification_required`
   means the latter). Optional: `AI_GATEWAY_MODEL` to change the model.
2. **Stripe live mode**: activate/claim the Stripe account, then run
   `STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-setup.mjs https://flipcast.dev`
   and set the `STRIPE_*` variables it prints in Vercel (Production).
3. **Vercel Pro**: Hobby is for non-commercial use; required before charging.

Known limits: Auto-track needs a format the browser can decode
(falls back to centre otherwise); transcription speed depends on the device.

## 4. Oracle VM (deferred, not required)

The VM was the original render host and is **no longer on the critical path**.
If it is ever provisioned for other reasons:

- Image `Canonical Ubuntu 24.04 Minimal aarch64`, shape `VM.Standard.A1.Flex`
  (4 OCPU / 24 GB), public subnet, ingress TCP 22/80/443, SSH user `ubuntu`.
- Provisioning was blocked on shape capacity (E2 Micro full; needs A1.Flex with an
  ARM image, AD-2/AD-3).
- It would host Postgres and a `renderEngine: 'worker'` path for long clips,
  which are the one case the browser handles badly.