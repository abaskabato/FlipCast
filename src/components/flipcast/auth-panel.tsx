'use client';

import {
  AuthUIProvider,
  SignInForm,
  SignUpForm,
  authLocalization,
} from '@daveyplate/better-auth-ui';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

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
      onSessionChange={() => {
        onSignedIn?.();
      }}
    >
      <section className="fc-card p-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="fc-heading">
              {mode === 'signup' ? 'Create your account' : 'Sign in'}
            </h2>
            <p className="fc-body mt-1">
              Sign in to keep render history and monthly quota. Free tier needs no card.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}
            className="fc-btn-ghost shrink-0 !text-indigo-400 hover:!text-indigo-300"
          >
            {mode === 'signup' ? 'Have an account? Sign in' : 'New here? Sign up'}
          </button>
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
      </section>
    </AuthUIProvider>
  );
}