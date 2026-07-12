import { Capacitor, registerPlugin } from '@capacitor/core';

export type PerformanceTimingScope =
  | 'project-sync'
  | 'project-geojson'
  | 'dashboard-map'
  | 'offline-map';

export interface PerformanceTimingRecord {
  runId: number;
  phase: string;
  durationMs: number | null;
  status: string;
  reason?: string;
}

interface NativePerformanceTimingRecord {
  scope: PerformanceTimingScope;
  runId: number;
  phase: string;
  durationMs: number | null;
  status: string;
}

export interface NativePerformanceDiagnostics {
  logTiming(record: NativePerformanceTimingRecord): Promise<void>;
}

interface PerformanceTimingLoggerDependencies {
  writeConsole(label: string, record: PerformanceTimingRecord): void;
  isNativePlatform(): boolean;
  nativeSink: NativePerformanceDiagnostics;
}

const NativePerformanceDiagnosticsPlugin = registerPlugin<NativePerformanceDiagnostics>(
  'PerformanceDiagnostics',
);

export function createPerformanceTimingLogger(
  dependencies: PerformanceTimingLoggerDependencies,
): (scope: PerformanceTimingScope, record: PerformanceTimingRecord) => void {
  return (scope, record) => {
    dependencies.writeConsole(`[${scope}:timing]`, record);
    if (!dependencies.isNativePlatform()) return;
    void dependencies.nativeSink.logTiming({
      scope,
      runId: record.runId,
      phase: record.phase,
      durationMs: record.durationMs,
      status: record.status,
    }).catch(() => {});
  };
}

const writePerformanceTiming = createPerformanceTimingLogger({
  writeConsole: (label, record) => console.log(label, record),
  isNativePlatform: () => Capacitor.isNativePlatform(),
  nativeSink: NativePerformanceDiagnosticsPlugin,
});

export interface ActivePerformanceTiming {
  phase: string;
  startedAt: number;
}

export function logPerformanceTiming(
  scope: PerformanceTimingScope,
  record: PerformanceTimingRecord,
): void {
  writePerformanceTiming(scope, record);
}

export function logElapsedPerformanceTiming(
  scope: PerformanceTimingScope,
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
