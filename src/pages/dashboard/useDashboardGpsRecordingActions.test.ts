import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGpsAveraging } from '../../hooks/useGpsAveraging';
import type { GpsRecordingState, LocalGpsTrack, RecordedPoint } from '../../types/gpsTrack';
import {
  useDashboardGpsRecordingActions,
  type AveragedLandmarkPoint,
} from './useDashboardGpsRecordingActions';

vi.mock('../../hooks/useGpsAveraging', () => ({
  useGpsAveraging: vi.fn(),
}));

const POINTS: RecordedPoint[] = [
  { latitude: 45, longitude: -73, timestamp: 1 },
  { latitude: 45.01, longitude: -73.02, timestamp: 2 },
];

const TRACK: LocalGpsTrack = {
  id: 'track-1',
  name: 'Recorded route',
  color: '#377eb8',
  points: POINTS,
  createdAt: 1,
  updatedAt: 2,
};

const RESULT = {
  latitude: 45,
  longitude: -73,
  altitude: 12,
  horizontalAccuracyMeters: 2,
  verticalAccuracyMeters: 3,
  sampleCount: 10,
  rejectedCount: 0,
  elapsedMs: 10_000,
  confidence: 80,
  isStable: true,
};

const mockUseGpsAveraging = vi.mocked(useGpsAveraging);
let averagingState: ReturnType<typeof useGpsAveraging>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createController(overrides: Record<string, unknown> = {}) {
  return {
    currentTrackPoints: POINTS,
    startTrackRecording: vi.fn().mockResolvedValue(undefined),
    pauseTrackRecording: vi.fn().mockResolvedValue(undefined),
    resumeTrackRecording: vi.fn().mockResolvedValue(undefined),
    stopTrackRecording: vi.fn().mockResolvedValue(TRACK),
    discardTrackRecording: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createBatteryGuard(overrides: Record<string, unknown> = {}) {
  return {
    isOptimizationActive: vi.fn().mockResolvedValue(false),
    requestExemption: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

interface HookProps {
  recordingState: GpsRecordingState;
  tracksRevision: number;
}

function renderActions(overrides: Record<string, unknown> = {}) {
  const controller = createController();
  const batteryGuard = createBatteryGuard();
  const showToast = vi.fn();
  const onSaveAveragedPoint = vi.fn();
  const options = {
    controller,
    batteryGuard,
    showToast,
    onSaveAveragedPoint,
    ...overrides,
  };
  const hook = renderHook(
    ({ recordingState, tracksRevision }: HookProps) => useDashboardGpsRecordingActions({
      controller: options.controller as never,
      batteryGuard: options.batteryGuard as never,
      showToast: options.showToast as never,
      onSaveAveragedPoint: options.onSaveAveragedPoint as never,
      recordingState,
      tracksRevision,
    }),
    { initialProps: { recordingState: 'idle', tracksRevision: 0 } as HookProps },
  );
  return {
    ...hook,
    controller: options.controller as ReturnType<typeof createController>,
    batteryGuard: options.batteryGuard as ReturnType<typeof createBatteryGuard>,
    showToast: options.showToast as ReturnType<typeof vi.fn>,
    onSaveAveragedPoint: options.onSaveAveragedPoint as ReturnType<typeof vi.fn>,
  };
}

beforeEach(() => {
  averagingState = {
    status: 'idle',
    result: null,
    sampleCount: 0,
    gnss: { supported: false, multiBand: null, constellations: [] },
  };
  mockUseGpsAveraging.mockReset().mockImplementation(() => averagingState);
});

describe('useDashboardGpsRecordingActions recording', () => {
  it('publishes current geometry by revision and exposes stable recorder controls', () => {
    const controller = createController();
    const { result, rerender } = renderActions({ controller });

    expect(result.current.currentTrackPoints).toBe(POINTS);
    expect(result.current.currentTrackFeatureCollection.features).toHaveLength(1);
    expect(result.current.currentRecordingLocation).toBeNull();

    act(() => {
      result.current.openRecorder();
      result.current.pauseRecording();
      result.current.resumeRecording();
    });
    expect(result.current.isRecorderOpen).toBe(true);
    expect(controller.pauseTrackRecording).toHaveBeenCalledTimes(1);
    expect(controller.resumeTrackRecording).toHaveBeenCalledTimes(1);

    const nextPoints = [
      ...POINTS,
      { latitude: 46, longitude: -74, timestamp: 3 },
      { latitude: Number.NaN, longitude: -75, timestamp: 4 },
    ];
    controller.currentTrackPoints = nextPoints;
    rerender({ recordingState: 'recording', tracksRevision: 1 });
    expect(result.current.currentTrackPoints).toBe(nextPoints);
    expect(result.current.currentRecordingLocation).toEqual({ lng: -74, lat: 46 });

    rerender({ recordingState: 'paused', tracksRevision: 1 });
    expect(result.current.currentRecordingLocation).toEqual({ lng: -74, lat: 46 });

    rerender({ recordingState: 'idle', tracksRevision: 1 });
    expect(result.current.currentRecordingLocation).toBeNull();

    act(() => result.current.closeRecorder());
    expect(result.current.isRecorderOpen).toBe(false);
  });

  it('constructs the default battery collaborator when none is injected', () => {
    const controller = createController();
    const { result } = renderHook(() => useDashboardGpsRecordingActions({
      controller: controller as never,
      recordingState: 'idle',
      tracksRevision: 0,
      showToast: vi.fn(),
      onSaveAveragedPoint: vi.fn(),
    }));

    expect(result.current.showBatteryHint).toBe(false);
  });

  it('shows the Android battery hint after start and honors session dismissal', async () => {
    const batteryGuard = createBatteryGuard({
      isOptimizationActive: vi.fn().mockResolvedValue(true),
    });
    const { result, controller } = renderActions({ batteryGuard });

    act(() => result.current.startRecording());
    await waitFor(() => expect(result.current.showBatteryHint).toBe(true));
    expect(controller.startTrackRecording).toHaveBeenCalledTimes(1);

    act(() => result.current.dismissBatteryHint());
    expect(result.current.showBatteryHint).toBe(false);
    act(() => result.current.startRecording());
    await waitFor(() => expect(controller.startTrackRecording).toHaveBeenCalledTimes(2));
    expect(batteryGuard.isOptimizationActive).toHaveBeenCalledTimes(1);
  });

  it('does not show an inactive battery hint', async () => {
    const { result, controller, batteryGuard } = renderActions();

    act(() => result.current.startRecording());
    await waitFor(() => expect(controller.startTrackRecording).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(batteryGuard.isOptimizationActive).toHaveBeenCalledTimes(1));
    expect(result.current.showBatteryHint).toBe(false);
  });

  it('surfaces start failures and suppresses a late failure after unmount', async () => {
    const pending = deferred<void>();
    const controller = createController({
      startTrackRecording: vi.fn()
        .mockRejectedValueOnce(new Error('Location denied'))
        .mockRejectedValueOnce('native failure')
        .mockImplementationOnce(() => pending.promise),
    });
    const { result, showToast, unmount } = renderActions({ controller });

    act(() => result.current.startRecording());
    await waitFor(() => expect(showToast).toHaveBeenLastCalledWith('Location denied', 'error'));
    act(() => result.current.startRecording());
    await waitFor(() => expect(showToast).toHaveBeenLastCalledWith(
      'Could not start GPS recording.',
      'error',
    ));

    act(() => result.current.startRecording());
    unmount();
    await act(async () => pending.reject(new Error('late')));
    expect(showToast).toHaveBeenCalledTimes(2);
  });

  it('surfaces pause and resume command failures without unhandled rejections', async () => {
    const controller = createController({
      pauseTrackRecording: vi.fn().mockRejectedValue(new Error('pause failed')),
      resumeTrackRecording: vi.fn().mockRejectedValue(new Error('resume failed')),
    });
    const { result, showToast } = renderActions({ controller });

    act(() => {
      result.current.pauseRecording();
      result.current.resumeRecording();
    });

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(
      'Could not pause GPS recording.',
      'error',
    ));
    expect(showToast).toHaveBeenCalledWith('Could not resume GPS recording.', 'error');
  });

  it('surfaces battery optimization command failures', async () => {
    const batteryGuard = createBatteryGuard({
      isOptimizationActive: vi.fn()
        .mockRejectedValueOnce(new Error('check failed'))
        .mockResolvedValue(true),
      requestExemption: vi.fn().mockRejectedValue(new Error('request failed')),
    });
    const { result, showToast } = renderActions({ batteryGuard });

    act(() => result.current.startRecording());
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(
      'Could not check battery optimization settings.',
      'error',
    ));
    act(() => result.current.fixBatteryOptimization());
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(
      'Could not update battery optimization settings.',
      'error',
    ));
  });

  it('rechecks battery exemption and handles active, exempted, and unmounted results', async () => {
    const batteryGuard = createBatteryGuard({
      isOptimizationActive: vi.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    });
    const { result } = renderActions({ batteryGuard });

    act(() => result.current.startRecording());
    await waitFor(() => expect(result.current.showBatteryHint).toBe(true));
    act(() => result.current.fixBatteryOptimization());
    await waitFor(() => expect(batteryGuard.requestExemption).toHaveBeenCalledTimes(1));
    expect(result.current.showBatteryHint).toBe(true);
    act(() => result.current.fixBatteryOptimization());
    await waitFor(() => expect(result.current.showBatteryHint).toBe(false));

    const request = deferred<void>();
    const lateGuard = createBatteryGuard({
      requestExemption: vi.fn(() => request.promise),
      isOptimizationActive: vi.fn().mockResolvedValue(false),
    });
    const late = renderActions({ batteryGuard: lateGuard });
    act(() => late.result.current.fixBatteryOptimization());
    late.unmount();
    await act(async () => request.resolve());
    expect(lateGuard.isOptimizationActive).toHaveBeenCalledTimes(1);
  });

  it('reports saved and empty stops and ignores a late stop completion', async () => {
    const stop = vi.fn()
      .mockResolvedValueOnce(TRACK)
      .mockResolvedValueOnce(null);
    const controller = createController({ stopTrackRecording: stop });
    const { result, showToast } = renderActions({ controller });

    act(() => {
      result.current.openRecorder();
      result.current.stopRecording();
    });
    await waitFor(() => expect(showToast).toHaveBeenLastCalledWith('Track saved', 'success'));
    expect(result.current.isRecorderOpen).toBe(false);

    act(() => result.current.stopRecording());
    await waitFor(() => expect(showToast).toHaveBeenLastCalledWith(
      'No points were recorded',
      'error',
    ));

    const pending = deferred<LocalGpsTrack | null>();
    const late = renderActions({
      controller: createController({ stopTrackRecording: vi.fn(() => pending.promise) }),
    });
    act(() => late.result.current.stopRecording());
    late.unmount();
    await act(async () => pending.resolve(TRACK));
    expect(late.showToast).not.toHaveBeenCalled();
  });

  it('keeps the recorder open and reports a durable stop failure', async () => {
    const controller = createController({
      stopTrackRecording: vi.fn().mockRejectedValue(new Error('final write failed')),
    });
    const { result, showToast } = renderActions({ controller });

    act(() => {
      result.current.openRecorder();
      result.current.stopRecording();
    });
    await waitFor(() => expect(showToast).toHaveBeenLastCalledWith(
      'Could not save the GPS track. Your recording is still available to retry.',
      'error',
    ));

    expect(result.current.isRecorderOpen).toBe(true);
  });

  it('closes idle cancellation and confirms active recording discard', async () => {
    const { result, rerender, controller } = renderActions();

    act(() => {
      result.current.openRecorder();
      result.current.cancelRecording();
    });
    expect(result.current.isRecorderOpen).toBe(false);
    expect(result.current.recordingCancelOpen).toBe(false);

    rerender({ recordingState: 'recording', tracksRevision: 0 });
    act(() => {
      result.current.openRecorder();
      result.current.cancelRecording();
    });
    expect(result.current.recordingCancelOpen).toBe(true);
    act(() => result.current.dismissRecordingCancel());
    expect(result.current.recordingCancelOpen).toBe(false);

    act(() => {
      result.current.cancelRecording();
      result.current.confirmRecordingCancel();
    });
    expect(controller.discardTrackRecording).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.recordingCancelOpen).toBe(false));
    expect(result.current.isRecorderOpen).toBe(false);
  });

  it('keeps discard recovery available and reports deletion failure', async () => {
    const controller = createController({
      discardTrackRecording: vi.fn().mockRejectedValue(new Error('delete failed')),
    });
    const { result, rerender, showToast } = renderActions({ controller });
    rerender({ recordingState: 'paused', tracksRevision: 0 });

    act(() => {
      result.current.openRecorder();
      result.current.cancelRecording();
      result.current.confirmRecordingCancel();
    });
    await waitFor(() => expect(showToast).toHaveBeenLastCalledWith(
      'Could not discard the GPS track. Your recording is still available to retry.',
      'error',
    ));

    expect(result.current.recordingCancelOpen).toBe(true);
    expect(result.current.isRecorderOpen).toBe(true);
  });
});

describe('useDashboardGpsRecordingActions averaging', () => {
  it('starts, stops, resumes retained data, and collapses running overlays', () => {
    const { result, rerender } = renderActions();

    act(() => result.current.collectPoint());
    expect(result.current.isAveragingOpen).toBe(true);
    expect(result.current.averagingPhase).toBe('idle');
    expect(mockUseGpsAveraging).toHaveBeenLastCalledWith(false, { restartNonce: 1 });

    act(() => result.current.startAveraging());
    expect(result.current.averagingPhase).toBe('running');
    expect(mockUseGpsAveraging).toHaveBeenLastCalledWith(true, { restartNonce: 1 });
    act(() => result.current.closeGpsOverlays());
    expect(result.current.isAveragingOpen).toBe(false);
    expect(result.current.averagingPhase).toBe('stopped');

    averagingState = { ...averagingState, result: RESULT };
    rerender({ recordingState: 'idle', tracksRevision: 0 });
    act(() => result.current.collectPoint());
    expect(result.current.isAveragingOpen).toBe(true);
    expect(result.current.averagingPhase).toBe('stopped');
    expect(mockUseGpsAveraging).toHaveBeenLastCalledWith(false, { restartNonce: 1 });

    act(() => result.current.startAveraging());
    act(() => result.current.stopAveraging());
    expect(result.current.averagingPhase).toBe('stopped');
  });

  it('restarts collection after failed acquisition states', () => {
    averagingState = { ...averagingState, status: 'permission-denied' };
    const { result, rerender } = renderActions();

    act(() => result.current.startAveraging());
    expect(mockUseGpsAveraging).toHaveBeenLastCalledWith(false, { restartNonce: 1 });

    averagingState = { ...averagingState, status: 'error' };
    rerender({ recordingState: 'idle', tracksRevision: 0 });
    act(() => result.current.startAveraging());
    expect(mockUseGpsAveraging).toHaveBeenLastCalledWith(false, { restartNonce: 2 });
  });

  it('resets running and stopped sessions with explicit confirmation', () => {
    const { result } = renderActions();

    act(() => {
      result.current.collectPoint();
      result.current.startAveraging();
      result.current.requestAveragingReset();
    });
    expect(result.current.averagingResetOpen).toBe(true);
    act(() => result.current.cancelAveragingReset());
    expect(result.current.averagingResetOpen).toBe(false);
    act(() => {
      result.current.requestAveragingReset();
      result.current.confirmAveragingReset();
    });
    expect(result.current.averagingPhase).toBe('running');
    expect(mockUseGpsAveraging).toHaveBeenLastCalledWith(true, { restartNonce: 2 });

    act(() => {
      result.current.stopAveraging();
      result.current.requestAveragingReset();
      result.current.confirmAveragingReset();
    });
    expect(result.current.averagingPhase).toBe('idle');
    expect(mockUseGpsAveraging).toHaveBeenLastCalledWith(false, { restartNonce: 3 });
  });

  it('starts a new held session when stopped data has no result', () => {
    const { result } = renderActions();

    act(() => {
      result.current.collectPoint();
      result.current.startAveraging();
      result.current.stopAveraging();
      result.current.collectPoint();
    });

    expect(result.current.isAveragingOpen).toBe(true);
    expect(result.current.averagingPhase).toBe('idle');
    expect(mockUseGpsAveraging).toHaveBeenLastCalledWith(false, { restartNonce: 2 });
  });

  it('cancels and saves averaged points through the injected landmark port', () => {
    const point: AveragedLandmarkPoint = { latitude: 45, longitude: -73, altitude: 12 };
    const { result, onSaveAveragedPoint } = renderActions();

    act(() => {
      result.current.collectPoint();
      result.current.cancelAveraging();
    });
    expect(result.current.isAveragingOpen).toBe(false);
    expect(result.current.averagingPhase).toBe('idle');
    expect(mockUseGpsAveraging).toHaveBeenLastCalledWith(false, { restartNonce: 2 });

    act(() => {
      result.current.collectPoint();
      result.current.saveAveragedPoint(point);
    });
    expect(onSaveAveragedPoint).toHaveBeenCalledWith(point);
    expect(result.current.isAveragingOpen).toBe(false);
    expect(mockUseGpsAveraging).toHaveBeenLastCalledWith(false, { restartNonce: 4 });
  });

  it('closes the recorder while retaining a stopped averaging phase', () => {
    const { result } = renderActions();

    act(() => {
      result.current.openRecorder();
      result.current.collectPoint();
      result.current.startAveraging();
      result.current.stopAveraging();
      result.current.closeGpsOverlays();
    });

    expect(result.current.isRecorderOpen).toBe(false);
    expect(result.current.isAveragingOpen).toBe(false);
    expect(result.current.averagingPhase).toBe('stopped');
  });
});
