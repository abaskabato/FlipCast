'use client';

import { useEffect } from 'react';

import { reportError } from '@/lib/report-error';

/** Reports uncaught errors and unhandled promise rejections on every page. */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportError('unhandled', e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => reportError('unhandled', e.reason);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
