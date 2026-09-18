import {
  redactDiagnosticText,
  sanitizeDiagnosticFrame,
  sanitizeDiagnosticStack,
  toSafeDiagnosticError,
} from '../utils/errorDiagnostics'

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
          beforeBreadcrumb(breadcrumb) {
            const category = breadcrumb.category?.toLowerCase() ?? ''
            if (['fetch', 'http', 'xhr'].some((value) => category.includes(value))) {
              return null
            }
            return {
              ...breadcrumb,
              data: undefined,
              message: breadcrumb.message
                ? redactDiagnosticText(breadcrumb.message)
                : undefined,
            }
          },
          beforeSend(event) {
            const componentStack = event.contexts?.react?.componentStack
            const safeComponentStack = typeof componentStack === 'string'
              ? sanitizeDiagnosticStack(componentStack)
              : undefined
            event.user = undefined
            event.request = undefined
            event.extra = undefined
            event.contexts = safeComponentStack
              ? { react: { componentStack: safeComponentStack } }
              : undefined
            // Keep the engine version needed to diagnose parser compatibility,
            // without forwarding the full user agent or arbitrary SDK contexts.
            const engine = navigator.userAgent.match(/\b(Chrome)\/(\d+(?:\.\d+){0,3})\b/)
              ?? navigator.userAgent.match(/\b(AppleWebKit)\/(\d+(?:\.\d+){0,3})\b/)
            if (engine) {
              event.contexts = {
                ...event.contexts,
                browser: { name: engine[1] === 'Chrome' ? 'Chromium' : 'WebKit', version: engine[2] },
              }
            }
            if (event.message) event.message = redactDiagnosticText(event.message)
            for (const value of event.exception?.values ?? []) {
              if (value.value) value.value = redactDiagnosticText(value.value)
              if (value.stacktrace) {
                value.stacktrace = {
                  frames: value.stacktrace.frames?.flatMap((frame) => {
                    const safe = sanitizeDiagnosticFrame(frame)
                    return safe ? [safe] : []
                  }).slice(-24),
                }
              }
            }
            event.breadcrumbs = event.breadcrumbs?.map((breadcrumb) => ({
              ...breadcrumb,
              data: undefined,
              message: breadcrumb.message
                ? redactDiagnosticText(breadcrumb.message)
                : undefined,
            }))
            return event
          },
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
    const safeComponentStack = sanitizeDiagnosticStack(componentStack)
    native.captureException(toSafeDiagnosticError(error), {
      tags: safeComponentStack ? { react_component_stack: 'available' } : undefined,
      contexts: safeComponentStack ? { react: { componentStack: safeComponentStack } } : undefined,
    })
  } catch (captureError) {
    console.warn('[sentry] failed to report captured exception.', captureError)
  }
}
