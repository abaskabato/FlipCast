# Flipcast Product Roadmap

Source: original master spec (Next.js 15 + Vercel + Supabase video-resizing micro-SaaS
"Flipcast for Muse Spark"), plus decisions made during implementation.

## 1. Original spec (locked)

- App: AI multi-platform dual-format video publisher. Upload horizontal source,
  pick target ratio (9:16 / 1:1 / 16:9) and tracking mode (auto_center / smart_face /
  manual_crop), run transform pipeline, download deliverable.
- Required layout: `package.json`, `src/lib/supabase.ts`, `src/app/layout.tsx`,
  `src/app/page.tsx`, `src/app/api/transform/route.ts`,
  `src/components/flipcast/dashboard.tsx`.
- Deps as specced (`next 15`, `react 19`, `tailwind`, `supabase-js`, `lucide-react`).
  NOTE: `react@19.0.0-rc` does not exist on npm — upgraded to stable `react@^19`.
- DB schema: `profiles` + `video_jobs` with RLS (kept at `supabase/schema.sql` as reference).
- QA rules: `tsc --noEmit` clean, types aligned, no placeholder/mocked UI in final paths.
- Open follow-ups from spec: Clerk vs NextAuth vs Supabase Auth; Shotstack/Cloudinary
  vs self-hosted FFmpeg worker.

## 2. Decisions since spec (user-directed)

- Auth: Better Auth (email/password) replaces Supabase Auth. Server at `src/lib/auth.ts`,
  client at `src/lib/auth-client.ts`, handler at `src/app/api/auth/[...all]/route.ts`.
- DB: open-source Postgres via Drizzle ORM (`src/db/`). Neon serverless for prod,
  `docker compose` Postgres 16 for local. Supabase Postgres remains compatible as a
  connection string but is no longer required.
- Backend home: Oracle Cloud free tier — Ubuntu 24.04 Minimal aarch64 on
  `VM.Standard.A1.Flex` (4 OCPU / 24 GB). Runs Postgres + S3-compatible storage
  (MinIO) + FFmpeg worker. Next.js stays on Vercel.
- Storage: presigned direct-to-storage PUT (`POST /api/uploads/presign`) so 500MB
  files bypass Vercel's ~4.5MB body limit; `POST /api/uploads/local` is dev/small-file
  fallback only.
- Video engine: self-hosted FFmpeg worker (not Shotstack/Cloudinary) to keep it free
  and open source on the Oracle VM.

## 3. Current state (this commit)

Working: Better Auth sign-in/sign-up/sign-out UI, presign + local upload routes,
`POST /api/transform` with session + quota pre-check + `video_jobs` insert (pending),
`GET /api/jobs`, `GET /api/jobs/[id]`, `GET /api/downloads/[id]`,
`GET /api/me/usage`, dashboard auth panel + upload zone + engine params.
Build verified: `tsc --noEmit` clean, `next build` ok.

## 4. Remaining (in order)

1. FFmpeg worker: poll `pending` jobs → ffprobe duration → quota check →
   transcode (1080x1920 / 1080x1080 / 1920x1080 center-crop v1) → store output →
   `completed` + `download_url` + usage increment; `failed` path with error.
2. Oracle VM: provision blocked on shape capacity (E2 Micro full; use A1.Flex Ampere
   + ARM image, AD-2/AD-3). Then one-shot provision: Docker, Postgres, MinIO bucket,
   worker service, Nginx 80/443, firewall rules.
3. Billing: `POST /api/billing/checkout` + webhook (Stripe, graceful 503 without keys);
   wire Upgrade button; enforce quota in worker (not just pre-check).
4. Dashboard: real upload flow (presign→PUT→transform), polling via `GET /api/jobs/[id]`,
   history list, download links, live usage, remove simulated progress.
5. Hardening/ops: email verification + reset/OAuth, server-side file validation,
   rate limits backed by Redis for multi-instance, tests, monitoring.

## 5. Oracle VM spec (when provisioned)

- Image `Canonical Ubuntu 24.04 Minimal aarch64`, shape `VM.Standard.A1.Flex`
  (4 OCPU / 24 GB), public subnet (e.g. `10.0.1.0/24` if `10.0.0.0/24` collides),
  ingress TCP 22/80/443, SSH user `ubuntu`.
