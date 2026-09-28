# Flipcast — Muse Spark

AI Multi-Platform Dual-Format Video Publisher. Upload a horizontal source asset, pick a target aspect ratio and focal tracking engine, and run the Flipcast transformation pipeline.

Built on Next.js 15, Vercel, Better Auth, and open-source Postgres.

## Stack

- Next.js 15, React 19, TypeScript
- Tailwind CSS 3.4 + lucide-react icons
- Better Auth (email/password) via `src/lib/auth.ts`, client via `src/lib/auth-client.ts`
- Open-source Postgres via Drizzle ORM (`src/db/`):
  - Prod: Neon serverless Postgres (Apache 2.0, Vercel-native)
  - Local/self-hosted: `docker compose up -d` (Postgres 16, pure open source)
  - Any Postgres URL also works (including existing Supabase Postgres)
- API routes: `POST /api/auth/*` (Better Auth), `POST /api/transform` (creates a `video_jobs` row when signed in)

## Structure

```
├── drizzle.config.ts
├── docker-compose.yml
├── drizzle/                  # generated SQL migrations (drizzle-kit generate)
├── src/
│   ├── db/schema.ts          # user/session/account/verification + video_jobs
│   ├── db/index.ts           # Drizzle + pg Pool (lazy, build-safe)
│   ├── lib/auth.ts           # Better Auth server instance
│   ├── lib/auth-client.ts    # signIn/signUp/signOut/useSession
│   ├── app/api/auth/[...all]/route.ts
│   ├── app/api/transform/route.ts
│   └── components/flipcast/dashboard.tsx
├── supabase/schema.sql       # legacy Supabase schema (reference only)
└── .env.example
```

## Setup

1. `npm install`
2. `cp .env.example .env.local` and set `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
   - Local open-source DB: `docker compose up -d` → `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/flipcast`
   - Or create a free Neon project and use its pooled connection string
3. `npm run db:generate && npm run db:migrate` (or `npm run db:push` for prototyping)
4. `npm run dev` — open http://localhost:3000, sign up, then run a transform
5. `npm run build` to verify production build

## Notes

- `/api/transform` prefers the Better Auth session; without one it still returns a mock job with `persisted: false` so the UI pipeline works in preview.
- `supabase/schema.sql` is kept for reference; the canonical schema is now `src/db/schema.ts` + `drizzle/`.

## License

MIT
