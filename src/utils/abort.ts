export function createAbortError(message = 'Operation aborted'): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException(message, 'AbortError')
  }

  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

export function isAbortError(error: unknown): boolean {
  return Boolean(
    (error instanceof DOMException && error.name === 'AbortError') ||
      (error instanceof Error && error.name === 'AbortError'),
  )
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return

  const { reason } = signal
  if (reason instanceof Error) {
    throw reason
  }

  if (typeof reason === 'string' && reason.trim()) {
    throw createAbortError(reason)
  }

  throw createAbortError()
}
