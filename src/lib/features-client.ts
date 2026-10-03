'use client';

import { useEffect, useState } from 'react';

export type Features = { clips: boolean; email: boolean; youtube: boolean; tiktok: boolean; tiktokScheduling: boolean };

const OFF: Features = { clips: false, email: false, youtube: false, tiktok: false, tiktokScheduling: false };
let pending: Promise<Features> | null = null;

/** Which optional features are live (/api/features), fetched once per page. Off until known. */
export function useFeatures(): Features {
  const [features, setFeatures] = useState<Features>(OFF);
  useEffect(() => {
    pending ??= fetch('/api/features')
      .then((r) => (r.ok ? r.json() : OFF))
      .catch(() => OFF);
    let live = true;
    void pending.then((f) => live && setFeatures(f));
    return () => {
      live = false;
    };
  }, []);
  return features;
}
