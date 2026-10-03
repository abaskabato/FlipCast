import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { db } from '@/db';
import * as schema from '@/db/schema';

/**
 * Better Auth server instance.
 *
 * The client at src/lib/auth-client.ts and the UI kit at
 * @daveyplate/better-auth-ui both talk to this instance via /api/auth/*.
 */
export const auth = betterAuth({
  appName: 'Flipcast',
  secret: resolveSecret(),
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
  /**
   * Better Auth rejects state-changing requests whose Origin header does not
   * match baseURL. `BETTER_AUTH_URL` is the canonical public URL (correct in
   * production), but that makes every local or preview origin fail with
   * INVALID_ORIGIN / 403 on sign-up and sign-in.
   *
   * Listing trusted origins keeps CSRF protection on while letting local dev
   * and Vercel preview deployments actually authenticate. Never use a
   * wildcard: that removes the origin check entirely.
   */
  trustedOrigins: buildTrustedOrigins(),
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
    // Backs the "forgot password" flow in the auth UI. Without an email
    // provider configured Better Auth still issues the reset token but cannot
    // deliver it, so the UI shows a generic success message rather than
    // leaking whether an address exists.
    sendResetPassword: async ({ user, token }) => {
      const url = `${process.env.BETTER_AUTH_URL || 'http://localhost:3000'}/reset-password?token=${token}`;
      await sendAuthEmail({
        to: user.email,
        subject: 'Reset your Flipcast password',
        text: `Hi ${user.name || 'there'},\n\nReset your password here:\n${url}\n\nIf you did not request this you can ignore this email.`,
      });
    },
    // Verification is deliberately NOT required to sign in: gating sign-in on
    // an email we cannot yet deliver would lock every new user out of a
    // product whose value is entirely local rendering.
    requireEmailVerification: false,
  },
  session: {
    // Keep users signed in for a month; renders are long-lived workflows.
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 60,
  },
  user: {
    // Accounts are never email-verified (no mail provider yet), so a change
    // applies immediately. The Stripe customer's email follows on the next
    // billing portal visit (see /api/billing/portal).
    changeEmail: {
      enabled: true,
      updateEmailWithoutVerification: true,
    },
    deleteUser: {
      enabled: true,
      // Cancel billing first. If Stripe fails the deletion is refused, so a
      // subscription can never outlive the account that pays for it. Imported
      // lazily: billing code is server-only and this file is also loaded by
      // the Better Auth CLI.
      beforeDelete: async (user) => {
        const { closeBillingAccount } = await import('@/lib/billing/sync');
        await closeBillingAccount(user.id);
      },
    },
    additionalFields: {
      subscriptionTier: { type: 'string', defaultValue: 'free', input: false },
      monthlyUsageSeconds: { type: 'number', defaultValue: 0, input: false },
      usagePeriodStart: { type: 'date', input: false },
      maxUsageLimit: { type: 'number', input: false },
    },
  },
});

/**
 * The Better Auth signing secret.
 *
 * This value is what makes a session cookie unforgeable, so a predictable one is
 * equivalent to having no authentication at all: anyone who knows it can mint a
 * cookie for any user id and read or modify their data.
 *
 * Therefore in production we refuse to start without a real secret rather than
 * falling back. The dev fallback is intentionally hardcoded and only reachable
 * when NODE_ENV !== 'production'.
 *
 * One exception: `next build` imports every API route module during "collect
 * page data", which evaluates this file with production NODE_ENV but no runtime
 * env vars. Throwing there fails the deploy before it can serve anything, which
 * is the wrong trade -- a build that cannot render is not more secure than a
 * build that succeeds. NEXT_PHASE is set only by `next build` and never at
 * runtime, so this branch cannot be reached by a live server. The placeholder is
 * never used to sign anything: no page is prerendered with a session, and the
 * runtime path below still throws.
 */
function resolveSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();

  if (secret && secret.length >= 32) return secret;

  if (isBuildPhase()) {
    console.warn(
      '[auth] BETTER_AUTH_SECRET is not set. Using a build-time placeholder; ' +
        'the deployed server will refuse to start until it is configured.',
    );
    return 'build-phase-placeholder-not-used-at-runtime-0';
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'BETTER_AUTH_SECRET is missing or shorter than 32 characters. ' +
        'Generate one with: openssl rand -base64 32',
    );
  }

  // Dev only. Never reached in production, per the check above.
  return secret || 'dev-only-insecure-secret-min-32-chars-abcdef';
}

/**
 * True only while `next build` is running.
 *
 * Set by next/dist/build/index.js before compilation begins, and absent in the
 * serverless runtime. Deliberately does not consult VERCEL or NODE_ENV, both of
 * which are also true during a real request on Vercel.
 */
function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === 'phase-production-build';
}

/**
 * Origins allowed to make authenticated requests.
 *
 * Always includes the configured baseURL, localhost/127.0.0.1 on the usual dev
 * ports, and any Vercel preview deployment for this project. Add production
 * domains via AUTH_TRUSTED_ORIGINS (comma separated) rather than a wildcard.
 */
function buildTrustedOrigins(): string[] {
  const origins = new Set<string>();

  const base = process.env.BETTER_AUTH_URL || 'http://localhost:3000';
  origins.add(base);

  for (const extra of (process.env.AUTH_TRUSTED_ORIGINS ?? '').split(',')) {
    const trimmed = extra.trim();
    if (trimmed) origins.add(trimmed);
  }

  // Local development across the ports this project actually uses.
  for (const port of [3000, 3100, 3001, 5173]) {
    origins.add(`http://localhost:${port}`);
    origins.add(`http://127.0.0.1:${port}`);
  }

  // Vercel preview deployments for this project. Preview hostnames are not
  // derivable from the env vars Vercel exposes, so long-lived ones must be
  // listed in AUTH_TRUSTED_ORIGINS.
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) {
    origins.add(vercelUrl.startsWith('http') ? vercelUrl : `https://${vercelUrl}`);
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    origins.add(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  }
  // Covers the standard https://<project>-<hash>-<team>.vercel.app shape.
  return [...origins];
}

/**
 * Minimal email sender. Uses Resend when RESEND_API_KEY is set, otherwise logs
 * the link to stdout in development so password reset is testable locally.
 */
async function sendAuthEmail(args: { to: string; subject: string; text: string }): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV !== 'production') {
      console.info(`[auth-email] to=${args.to} subject=${args.subject}\n${args.text}`);
    } else {
      console.error('[auth-email] RESEND_API_KEY missing; email not sent');
    }
    return;
  }
  const from = process.env.AUTH_EMAIL_FROM || 'Flipcast <noreply@flipcast.app>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [args.to], subject: args.subject, text: args.text }),
  });
  if (!res.ok) {
    console.error('[auth-email] send failed', res.status, await res.text());
  }
}

export type Auth = typeof auth;