import type { Metadata } from 'next';

import PasswordReset from '@/components/flipcast/password-reset';

export const metadata: Metadata = { title: 'Reset your password — Flipcast', robots: { index: false } };

export default function ForgotPasswordPage() {
  return <PasswordReset step="request" />;
}
