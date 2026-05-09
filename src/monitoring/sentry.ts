function resolveDsn(): string | undefined {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim()
  return dsn ? dsn : undefined
}

type SentryModules = {
  native: typeof import('@sentry/capacitor')
  react: typeof import('@sentry/react')
}

let sentryModulesPromise: Promise<SentryModules> | null = null

async function loadSentryModules(): Promise<SentryModules> {
  if (!sentryModulesPromise) {
    sentryModulesPromise = Promise.all([
      import('@sentry/capacitor'),
      import('@sentry/react'),
    ]).then(([native, react]) => ({ native, react }))
  }

  return sentryModulesPromise
}

export function initSentry(): void {
  const dsn = resolveDsn()
  if (!dsn) {
    if (import.meta.env.DEV) {
      console.warn('[sentry] VITE_SENTRY_DSN is not set. Sentry is disabled.')
    }
    return
  }

  void loadSentryModules()
    .then(({ native, react }) => {
      native.init(
        {
          dsn,
          enableNative: true,
          debug: import.meta.env.DEV,
          environment: import.meta.env.MODE,
          sendDefaultPii: false,
        },
        react.init,
      )
    })
    .catch((error) => {
      console.warn('[sentry] init failed; continuing without Sentry.', error)
    })
}

export async function captureSentryException(
  error: unknown,
  componentStack?: string,
): Promise<void> {
  if (!resolveDsn()) return

  try {
    const { native } = await loadSentryModules()
    native.captureException(error, {
      extra: componentStack ? { componentStack } : undefined,
    })
  } catch (captureError) {
    console.warn('[sentry] failed to report captured exception.', captureError)
  }
}
