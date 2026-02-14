import * as Sentry from '@sentry/capacitor';
import * as SentryReact from '@sentry/react';

function resolveDsn(): string | undefined {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  return dsn ? dsn : undefined;
}

export function initSentry(): void {
  const dsn = resolveDsn();
  if (!dsn) {
    if (import.meta.env.DEV) {
      console.warn('[sentry] VITE_SENTRY_DSN is not set. Sentry is disabled.');
    }
    return;
  }

  try {
    Sentry.init(
      {
        dsn,
        enableNative: true,
        debug: import.meta.env.DEV,
        environment: import.meta.env.MODE,
        sendDefaultPii: false,
      },
      SentryReact.init,
    );
  } catch (error) {
    console.warn('[sentry] init failed; continuing without Sentry.', error);
  }
}
