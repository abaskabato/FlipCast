'use client';

import {
  AuthUIProvider,
  SignInForm,
  SignUpForm,
  authLocalization,
} from '@daveyplate/better-auth-ui';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { formatQuota, TIER_LIMITS } from '@/lib/quotas';

/**
 * The forms require an explicit `localization` prop. Reuse the library's own
 * strings so nothing is missing, with a couple of words tuned for this product.
 */
const AUTH_LOCALIZATION = authLocalization as unknown as Record<string, unknown>;

/**
 * Auth panel built on better-auth-ui, sitting on top of our Better Auth
 * instance (src/lib/auth.ts). This replaces the hand-rolled inline form that
 * previously had no password reset and no verification flow.
 */
export function AuthPanel({ onSignedIn }: { onSignedIn?: () => void }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');

  return (
    <AuthUIProvider
      authClient={authClient}
      emailVerification={false}
      account={false}
      deleteUser={false}
      // No reset page or email provider is deployed yet, so the library's
      // "Forgot password?" link would lead to a 404. Re-enable once both exist.
      credentials={{ forgotPassword: false }}
      onSessionChange={() => {
        onSignedIn?.();
      }}
    >
      <section className="fc-card p-6">
        <div className="mb-5">
          <h2 className="fc-heading">
            {mode === 'signup' ? 'Create your free account' : 'Sign in to render'}
          </h2>
          <p className="fc-body mt-1">
            {mode === 'signup'
              ? `${formatQuota(TIER_LIMITS.free)} of rendering a month, free. No card needed.`
              : 'Your account keeps your render history and monthly allowance.'}
          </p>
        </div>

        {/* better-auth-ui ships its own card chrome; strip the outer border so
            it nests cleanly inside this panel.

            It also renders its buttons and links at ~20px tall with 13px type,
            which is both hard to read and under any usable tap target. The
            library does not expose those styles as props, so they are pinned
            from here. Deliberately broad: everything inside this wrapper is a
            form control, and the audit that motivated this flagged all of it. */}
        <div className="[&>div]:border-0 [&>div]:bg-transparent [&>div]:p-0 [&>div]:shadow-none [&_button]:min-h-[44px] [&_button]:text-sm [&_button]:font-semibold [&_a]:inline-flex [&_a]:min-h-[32px] [&_a]:items-center [&_label]:text-sm [&_input]:text-sm">
          {mode === 'signup' ? (
            <SignUpForm localization={AUTH_LOCALIZATION} />
          ) : (
            <SignInForm localization={AUTH_LOCALIZATION} />
          )}
        </div>

        {/* The mode switch sits under the form, where people look for it,
            instead of competing with the heading for width. */}
        <p className="mt-4 border-t border-white/[0.06] pt-4 text-center text-sm text-zinc-400">
          {mode === 'signup' ? 'Already have an account?' : 'New to Flipcast?'}{' '}
          <button
            type="button"
            onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}
            className="fc-link"
          >
            {mode === 'signup' ? 'Sign in' : 'Create a free account'}
          </button>
        </p>
      </section>
    </AuthUIProvider>
  );
}