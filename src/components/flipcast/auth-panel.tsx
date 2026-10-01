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
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-bold tracking-tight text-white">
              {mode === 'signup' ? 'Create your account' : 'Sign in'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Sign in to keep render history and monthly quota. Free tier needs no card.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}
            className="shrink-0 text-[11px] font-semibold text-indigo-400 transition-colors hover:text-indigo-300"
          >
            {mode === 'signup' ? 'Have an account? Sign in' : 'New here? Sign up'}
          </button>
        </div>

        {/* better-auth-ui ships its own card chrome; strip the outer border so
            it nests cleanly inside this panel. */}
        <div className="[&>div]:border-0 [&>div]:bg-transparent [&>div]:p-0 [&>div]:shadow-none">
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