import { describe, expect, it, vi } from 'vitest';
import {
  createPerformanceTimingLogger,
  type PerformanceTimingRecord,
} from './performanceTiming';

const RECORD: PerformanceTimingRecord = {
  runId: 7,
  phase: 'project_refresh',
  durationMs: 12.3,
  status: 'applied',
  reason: 'project_list_refreshed',
};

describe('performance timing diagnostics', () => {
  it('writes browser diagnostics and only allowlisted fields to the native sink', () => {
    const writeConsole = vi.fn();
    const logTiming = vi.fn(async () => {});
    const log = createPerformanceTimingLogger({
      writeConsole,
      isNativePlatform: () => true,
      nativeSink: { logTiming },
    });

    log('project-sync', RECORD);

    expect(writeConsole).toHaveBeenCalledWith('[project-sync:timing]', RECORD);
    expect(logTiming).toHaveBeenCalledWith({
      scope: 'project-sync',
      runId: 7,
      phase: 'project_refresh',
      durationMs: 12.3,
      status: 'applied',
    });
    expect(JSON.stringify(logTiming.mock.calls)).not.toContain('project_list_refreshed');
  });

  it('does not invoke the native bridge in a browser', () => {
    const writeConsole = vi.fn();
    const logTiming = vi.fn(async () => {});
    const log = createPerformanceTimingLogger({
      writeConsole,
      isNativePlatform: () => false,
      nativeSink: { logTiming },
    });

    log('offline-map', { ...RECORD, phase: 'plan_schedule' });

    expect(writeConsole).toHaveBeenCalledOnce();
    expect(logTiming).not.toHaveBeenCalled();
  });

  it('forwards aggregate project and Dashboard timing scopes without payload data', () => {
    const writeConsole = vi.fn();
    const logTiming = vi.fn(async () => {});
    const log = createPerformanceTimingLogger({
      writeConsole,
      isNativePlatform: () => true,
      nativeSink: { logTiming },
    });

    log('project-geojson', { ...RECORD, phase: 'validation_work' });
    log('dashboard-map', { ...RECORD, phase: 'project_total_to_paint' });

    expect(logTiming).toHaveBeenNthCalledWith(1, {
      scope: 'project-geojson',
      runId: 7,
      phase: 'validation_work',
      durationMs: 12.3,
      status: 'applied',
    });
    expect(logTiming).toHaveBeenNthCalledWith(2, {
      scope: 'dashboard-map',
      runId: 7,
      phase: 'project_total_to_paint',
      durationMs: 12.3,
      status: 'applied',
    });
  });

  it('contains a rejected native diagnostic without affecting sync work', async () => {
    const writeConsole = vi.fn();
    const log = createPerformanceTimingLogger({
      writeConsole,
      isNativePlatform: () => true,
      nativeSink: { logTiming: vi.fn(async () => { throw new Error('unavailable'); }) },
    });

    expect(() => log('project-sync', RECORD)).not.toThrow();
    await Promise.resolve();
    expect(writeConsole).toHaveBeenCalledOnce();
  });
});
