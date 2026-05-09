import React from 'react'
import { captureSentryException } from './sentry'

interface AppErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface AppErrorBoundaryState {
  hasError: boolean
}

export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    void captureSentryException(error, info.componentStack ?? undefined)
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return this.props.fallback ?? <div>Something went wrong.</div>
    }

    return this.props.children
  }
}
