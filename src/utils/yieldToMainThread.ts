interface SchedulingApi {
  yield?: () => Promise<void>;
}

/** Yield the WebView thread so rendering and input can run before more local work. */
export function yieldToMainThread(): Promise<void> {
  const scheduler = (globalThis as typeof globalThis & { scheduler?: SchedulingApi }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Admit background work only after the current foreground task can paint. */
export function deferToNextTask(work: () => void): void {
  setTimeout(work, 0);
}
