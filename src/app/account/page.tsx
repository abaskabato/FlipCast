import type { Metadata } from 'next';

import AccountView from '@/components/flipcast/account-view';

export const metadata: Metadata = {
  title: 'Your account — Flipcast',
  robots: { index: false },
};

export default function AccountPage() {
  return (
    <main className="min-h-screen p-4 md:p-8">
      <AccountView />
    </main>
  );
}
