import { createAbortError, throwIfAborted } from '../utils/abort'

export class CancellationContext {
  private abortController = new AbortController()

  constructor(
    public readonly runId: number,
    private readonly label: string,
  ) {}

  get signal(): AbortSignal {
    return this.abortController.signal
  }

  abort(reason?: string): void {
    if (this.signal.aborted) return
    this.abortController.abort(
      createAbortError(reason ?? `${this.label} run ${this.runId} aborted`),
    )
  }

  throwIfAborted(): void {
    throwIfAborted(this.signal)
  }
}
