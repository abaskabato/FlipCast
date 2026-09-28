import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { db } from '@/db';
import * as schema from '@/db/schema';

export const auth = betterAuth({
  secret:
    process.env.BETTER_AUTH_SECRET || 'build-placeholder-secret-min-32-chars-1234567890',
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  emailAndPassword: {
    enabled: true,
  },
});

export type Auth = typeof auth;
