import React from 'react'
import { captureSentryException } from './sentry'

interface AppErrorBoundaryProps {
  children: React.ReactNode
}

interface AppErrorBoundaryState {
  hasError: boolean
  error: Error | null
  componentStack: string | null
}

export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { hasError: false, error: null, componentStack: null }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { hasError: true, error, componentStack: null }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const componentStack = info.componentStack ?? undefined
    // Always surface the real error to the console so it shows up in the device
    // web inspector / Xcode / logcat -- otherwise a render crash only renders a
    // bare "Something went wrong" with no clue what failed.
    console.error('[AppErrorBoundary] Uncaught render error:', error)
    if (componentStack) {
      console.error('[AppErrorBoundary] Component stack:', componentStack)
    }
    this.setState({ componentStack: componentStack ?? null })
    void captureSentryException(error, componentStack)
  }

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children
    }

    const { error, componentStack } = this.state
    const message = error?.message ?? String(error ?? 'Unknown error')
    const name = error?.name ?? 'Error'
    const details = [error?.stack, componentStack].filter(Boolean).join('\n\n')
    // Only surface the raw error + stack on-screen in dev builds; production
    // shows a clean message (the full error always goes to the console + Sentry).
    const showDetails = Boolean(import.meta.env?.DEV)

    // Inline styles only: the app's CSS/components may be exactly what broke, so
    // the crash screen must not depend on them.
    return (
      <div
        data-testid="app-error-boundary"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 2147483647,
          overflow: 'auto',
          padding: '16px',
          background: '#0f172a',
          color: '#e2e8f0',
          font: '13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '8px' }}>
          Something went wrong.
        </div>
        {showDetails && (
          <>
            <div style={{ color: '#fca5a5', whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: '12px' }}>
              {name}: {message}
            </div>
            {details && (
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, color: '#94a3b8' }}>
                {details}
              </pre>
            )}
          </>
        )}
      </div>
    )
  }
}
