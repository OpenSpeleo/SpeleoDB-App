export interface PerformanceTimingRecord {
  runId: number;
  phase: string;
  durationMs: number | null;
  status: string;
  reason?: string;
}

export interface ActivePerformanceTiming {
  phase: string;
  startedAt: number;
}

export function logPerformanceTiming(
  scope: 'project-sync' | 'offline-map',
  record: PerformanceTimingRecord,
): void {
  console.info(`[${scope}:timing]`, record);
}

export function logElapsedPerformanceTiming(
  scope: 'project-sync' | 'offline-map',
  runId: number,
  timing: ActivePerformanceTiming,
  status: string,
  now: () => number = () => performance.now(),
): void {
  const elapsed = Math.max(0, now() - timing.startedAt);
  logPerformanceTiming(scope, {
    runId,
    phase: timing.phase,
    durationMs: Math.round(elapsed * 10) / 10,
    status,
  });
}
