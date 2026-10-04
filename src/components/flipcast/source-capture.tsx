'use client';

import { useEffect } from 'react';

import { useSession } from '@/lib/auth-client';
import { cleanReferrer, cleanSource, type SignupSource } from '@/lib/signup-source';

const KEY = 'fc_source';
const SENT = 'fc_source_sent';

/**
 * Remembers how a visitor first arrived (the ?ref= / ?utm_source= tag and the
 * referring site), then hands it to the server once, after they sign up. Kept
 * in this browser's storage only until then; nothing third-party is involved.
 */
export function SourceCapture() {
  const { data: session } = useSession();

  // First visit: note where it came from, unless something is already noted.
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY)) return;
      const params = new URLSearchParams(window.location.search);
      const referrer = cleanReferrer(document.referrer);
      const own = referrer === window.location.hostname.replace(/^www\./, '');
      const found: SignupSource = {
        source: cleanSource(params.get('ref') ?? params.get('utm_source')),
        referrer: own ? null : referrer,
      };
      localStorage.setItem(KEY, JSON.stringify(found));
    } catch {
      /* storage unavailable: nothing to remember */
    }
  }, []);

  // Signed in: report it once. The server keeps it only for new accounts.
  const userId = session?.user?.id;
  useEffect(() => {
    if (!userId) return;
    try {
      if (localStorage.getItem(SENT) === userId) return;
      const stored = localStorage.getItem(KEY);
      if (!stored) return;
      void fetch('/api/me/source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stored })
        .then((res) => {
          if (res.ok) localStorage.setItem(SENT, userId);
        })
        .catch(() => undefined);
    } catch {
      /* storage unavailable */
    }
  }, [userId]);

  return null;
}
