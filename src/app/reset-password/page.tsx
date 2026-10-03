import type { Metadata } from 'next';

import PasswordReset from '@/components/flipcast/password-reset';

export const metadata: Metadata = { title: 'Choose a new password — Flipcast', robots: { index: false } };

export default function ResetPasswordPage() {
  return <PasswordReset step="reset" />;
}
