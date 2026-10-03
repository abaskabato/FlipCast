'use client';

import { AuthUIProvider, ForgotPasswordForm, ResetPasswordForm, authLocalization } from '@daveyplate/better-auth-ui';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

import { authClient } from '@/lib/auth-client';
import { SiteFooter } from './site-chrome';
import { SiteHeader } from './site-header';

const AUTH_LOCALIZATION = authLocalization as unknown as Record<string, unknown>;

/**
 * "Forgot password" (request a link) and "Reset password" (from the emailed
 * link, /reset-password?token=...). Better Auth issues the token and sends the
 * email through Resend (src/lib/auth.ts); these pages are only linked from the
 * sign-in form once email delivery is configured.
 */
export default function PasswordReset({ step }: { step: 'request' | 'reset' }) {
  // The forms finish by sending people to the library's sign-in page, which
  // Flipcast does not have (sign-in lives on the home page). Show the outcome
  // here instead.
  const [done, setDone] = useState(false);
  const go = useCallback((href: string) => {
    if (href.includes('/auth/sign-in')) setDone(true);
    else window.location.href = href;
  }, []);
  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-6xl px-1 py-2 sm:px-2">
        <SiteHeader />
        <AuthUIProvider authClient={authClient} emailVerification={false} account={false} deleteUser={false} credentials={{ forgotPassword: true }} navigate={go} replace={go}>
          <section className="fc-card mx-auto mt-16 max-w-md p-6">
            <h1 className="fc-heading">{step === 'request' ? 'Reset your password' : 'Choose a new password'}</h1>
            <p className="fc-body mt-1 mb-5">
              {step === 'request'
                ? "Enter your account's email and we'll send you a link to set a new password."
                : 'Pick a new password for your Flipcast account.'}
            </p>
            {done ? (
              <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4 text-sm text-emerald-100" role="status">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                <span>
                  {step === 'request'
                    ? 'If that email has a Flipcast account, a reset link is on its way. Check your inbox (and spam).'
                    : 'Your password is updated. Sign in with the new one.'}
                </span>
              </div>
            ) : (
            <div className="[&>div]:border-0 [&>div]:bg-transparent [&>div]:p-0 [&>div]:shadow-none [&_button]:min-h-[44px] [&_button]:text-sm [&_button]:font-semibold [&_label]:text-sm [&_input]:text-sm">
              {step === 'request' ? (
                <ForgotPasswordForm localization={AUTH_LOCALIZATION} />
              ) : (
                <ResetPasswordForm localization={AUTH_LOCALIZATION} />
              )}
            </div>
            )}
            <p className="mt-4 border-t border-white/[0.06] pt-4 text-center text-sm text-zinc-400">
              Remembered it?{' '}
              <Link href="/#account" className="fc-link">
                Sign in
              </Link>
            </p>
          </section>
        </AuthUIProvider>
        <SiteFooter />
      </div>
    </main>
  );
}
