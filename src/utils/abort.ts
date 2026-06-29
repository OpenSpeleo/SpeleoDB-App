export function createAbortError(message = 'Operation aborted'): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException(message, 'AbortError')
  }

  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

interface AbortErrorLike {
  name: 'AbortError'
  message?: unknown
}

export function isAbortError(error: unknown): error is AbortErrorLike {
  return Boolean(
    error
      && typeof error === 'object'
      && 'name' in error
      && error.name === 'AbortError',
  )
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return

  const { reason } = signal
  if (isAbortError(reason)) {
    const message = 'message' in reason && typeof reason.message === 'string'
      ? reason.message
      : undefined
    throw createAbortError(message)
  }

  if (reason instanceof Error) {
    throw reason
  }

  if (typeof reason === 'string' && reason.trim()) {
    throw createAbortError(reason)
  }

  throw createAbortError()
}
