import { useCallback, useMemo, useRef, useState } from 'react';
import type { SpeleoDBController } from '../../controllers/SpeleoDBController';
import { useGpsAveraging } from '../../hooks/useGpsAveraging';
import type { UseGpsAveraging } from '../../hooks/useGpsAveraging';
import { useMountedRef } from '../../hooks/useMountedRef';
import { BatteryOptimizationGuard } from '../../services/BatteryOptimizationGuard';
import type {
  GpsRecordingState,
  LocalGpsTrack,
  RecordedPoint,
} from '../../types/gpsTrack';
import type { UserMapLocation } from '../../types/userLocation';
import type { GpsAveragingPhase } from '../../components/GpsAveragingModal';
import { trackPointsToFeatureCollection } from '../../utils/gpsTrackGeoJson';
import { latestValidRecordingLocation } from '../../utils/userLocation';

type RecordingController = Pick<
  SpeleoDBController,
  | 'currentTrackPoints'
  | 'startTrackRecording'
  | 'pauseTrackRecording'
  | 'resumeTrackRecording'
  | 'stopTrackRecording'
  | 'discardTrackRecording'
>;
type BatteryGuard = Pick<
  BatteryOptimizationGuard,
  'isOptimizationActive' | 'requestExemption'
>;
type Toast = (message: string, tone: 'success' | 'error') => void;

export interface AveragedLandmarkPoint {
  latitude: number;
  longitude: number;
  altitude: number | null;
}

export interface DashboardGpsRecordingActionOptions {
  controller: RecordingController;
  recordingState: GpsRecordingState;
  tracksRevision: number;
  showToast: Toast;
  onSaveAveragedPoint: (point: AveragedLandmarkPoint) => void;
  batteryGuard?: BatteryGuard;
}

export interface DashboardGpsRecordingActionState {
  currentTrackPoints: RecordedPoint[];
  currentTrackFeatureCollection: GeoJSON.FeatureCollection;
  currentRecordingLocation: UserMapLocation | null;
  isRecorderOpen: boolean;
  showBatteryHint: boolean;
  recordingCancelOpen: boolean;
  openRecorder: () => void;
  closeRecorder: () => void;
  startRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  stopRecording: () => void;
  cancelRecording: () => void;
  dismissRecordingCancel: () => void;
  confirmRecordingCancel: () => void;
  fixBatteryOptimization: () => void;
  dismissBatteryHint: () => void;
  isAveragingOpen: boolean;
  averagingPhase: GpsAveragingPhase;
  averaging: UseGpsAveraging;
  averagingResetOpen: boolean;
  collectPoint: () => void;
  startAveraging: () => void;
  stopAveraging: () => void;
  requestAveragingReset: () => void;
  cancelAveragingReset: () => void;
  confirmAveragingReset: () => void;
  cancelAveraging: () => void;
  saveAveragedPoint: (point: AveragedLandmarkPoint) => void;
  closeGpsOverlays: () => void;
}

function useCurrentTrackGeometry(
  controller: RecordingController,
  recordingState: GpsRecordingState,
  tracksRevision: number,
): Pick<
  DashboardGpsRecordingActionState,
  'currentTrackPoints' | 'currentTrackFeatureCollection' | 'currentRecordingLocation'
> {
  const currentTrackPoints = useMemo(
    () => controller.currentTrackPoints,
    // A new fix is published by advancing the controller-owned revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, tracksRevision],
  );
  const currentTrackFeatureCollection = useMemo(
    () => trackPointsToFeatureCollection(currentTrackPoints, { name: 'Current GPS recording' }),
    [currentTrackPoints],
  );
  const currentRecordingLocation = useMemo(
    () => recordingState === 'idle' ? null : latestValidRecordingLocation(currentTrackPoints),
    [currentTrackPoints, recordingState],
  );
  return { currentTrackPoints, currentTrackFeatureCollection, currentRecordingLocation };
}

interface RecorderActionOptions {
  controller: RecordingController;
  recordingState: GpsRecordingState;
  showToast: Toast;
  batteryGuard: BatteryGuard;
}

function useBatteryOptimizationActions(
  batteryGuard: BatteryGuard,
  mountedRef: ReturnType<typeof useMountedRef>,
  showToast: Toast,
) {
  const batteryHintDismissedRef = useRef(false);
  const [showBatteryHint, setShowBatteryHint] = useState(false);

  const showHintIfActive = useCallback(async () => {
    if (batteryHintDismissedRef.current) return;
    let active: boolean;
    try {
      active = await batteryGuard.isOptimizationActive();
    } catch {
      if (mountedRef.current) {
        showToast('Could not check battery optimization settings.', 'error');
      }
      return;
    }
    if (mountedRef.current && active) setShowBatteryHint(true);
  }, [batteryGuard, mountedRef, showToast]);

  const fixBatteryOptimization = useCallback(() => {
    void (async () => {
      let stillActive: boolean;
      try {
        await batteryGuard.requestExemption();
        stillActive = await batteryGuard.isOptimizationActive();
      } catch {
        if (mountedRef.current) {
          showToast('Could not update battery optimization settings.', 'error');
        }
        return;
      }
      if (!mountedRef.current || stillActive) return;
      setShowBatteryHint(false);
      batteryHintDismissedRef.current = true;
    })();
  }, [batteryGuard, mountedRef, showToast]);

  const dismissBatteryHint = useCallback(() => {
    batteryHintDismissedRef.current = true;
    setShowBatteryHint(false);
  }, []);

  return {
    showBatteryHint,
    showHintIfActive,
    fixBatteryOptimization,
    dismissBatteryHint,
  };
}

function useRecorderActions({
  controller,
  recordingState,
  showToast,
  batteryGuard,
}: RecorderActionOptions) {
  const mountedRef = useMountedRef();
  const [isRecorderOpen, setIsRecorderOpen] = useState(false);
  const [recordingCancelOpen, setRecordingCancelOpen] = useState(false);
  const battery = useBatteryOptimizationActions(batteryGuard, mountedRef, showToast);
  const { showHintIfActive } = battery;

  const startRecording = useCallback(() => {
    void (async () => {
      try {
        await controller.startTrackRecording();
      } catch (error) {
        if (!mountedRef.current) return;
        showToast(
          error instanceof Error ? error.message : 'Could not start GPS recording.',
          'error',
        );
        return;
      }
      await showHintIfActive();
    })();
  }, [controller, mountedRef, showHintIfActive, showToast]);

  const stopRecording = useCallback(() => {
    void (async () => {
      let track: LocalGpsTrack | null;
      try {
        track = await controller.stopTrackRecording();
      } catch {
        if (!mountedRef.current) return;
        showToast(
          'Could not save the GPS track. Your recording is still available to retry.',
          'error',
        );
        return;
      }
      if (!mountedRef.current) return;
      setIsRecorderOpen(false);
      showToast(track ? 'Track saved' : 'No points were recorded', track ? 'success' : 'error');
    })();
  }, [controller, mountedRef, showToast]);

  const cancelRecording = useCallback(() => {
    if (recordingState === 'idle') setIsRecorderOpen(false);
    else setRecordingCancelOpen(true);
  }, [recordingState]);

  const confirmRecordingCancel = useCallback(() => {
    void (async () => {
      try {
        await controller.discardTrackRecording();
      } catch {
        if (!mountedRef.current) return;
        showToast(
          'Could not discard the GPS track. Your recording is still available to retry.',
          'error',
        );
        return;
      }
      if (!mountedRef.current) return;
      setRecordingCancelOpen(false);
      setIsRecorderOpen(false);
    })();
  }, [controller, mountedRef, showToast]);

  const openRecorder = useCallback(() => setIsRecorderOpen(true), []);
  const closeRecorder = useCallback(() => setIsRecorderOpen(false), []);
  const pauseRecording = useCallback(() => {
    void controller.pauseTrackRecording().catch(() => {
      if (mountedRef.current) showToast('Could not pause GPS recording.', 'error');
    });
  }, [controller, mountedRef, showToast]);
  const resumeRecording = useCallback(() => {
    void controller.resumeTrackRecording().catch(() => {
      if (mountedRef.current) showToast('Could not resume GPS recording.', 'error');
    });
  }, [controller, mountedRef, showToast]);
  const dismissRecordingCancel = useCallback(() => setRecordingCancelOpen(false), []);

  return {
    isRecorderOpen,
    recordingCancelOpen,
    openRecorder,
    closeRecorder,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    cancelRecording,
    dismissRecordingCancel,
    confirmRecordingCancel,
    showBatteryHint: battery.showBatteryHint,
    fixBatteryOptimization: battery.fixBatteryOptimization,
    dismissBatteryHint: battery.dismissBatteryHint,
  };
}

function useAveragingActions(onSaveAveragedPoint: (point: AveragedLandmarkPoint) => void) {
  const [isAveragingOpen, setIsAveragingOpen] = useState(false);
  const [averagingPhase, setAveragingPhase] = useState<GpsAveragingPhase>('idle');
  const [averagingNonce, setAveragingNonce] = useState(0);
  const [averagingResetOpen, setAveragingResetOpen] = useState(false);
  const averaging = useGpsAveraging(isAveragingOpen && averagingPhase === 'running', {
    restartNonce: averagingNonce,
  });

  const collectPoint = useCallback(() => {
    if (averagingPhase === 'stopped' && averaging.result) {
      setIsAveragingOpen(true);
      return;
    }
    setAveragingPhase('idle');
    setAveragingNonce((nonce) => nonce + 1);
    setIsAveragingOpen(true);
  }, [averaging.result, averagingPhase]);

  const startAveraging = useCallback(() => {
    if (averaging.status === 'permission-denied' || averaging.status === 'error') {
      setAveragingNonce((nonce) => nonce + 1);
    }
    setAveragingPhase('running');
  }, [averaging.status]);

  const confirmAveragingReset = useCallback(() => {
    setAveragingResetOpen(false);
    setAveragingNonce((nonce) => nonce + 1);
    setAveragingPhase((phase) => (phase === 'running' ? 'running' : 'idle'));
  }, []);

  const cancelAveraging = useCallback(() => {
    setIsAveragingOpen(false);
    setAveragingPhase('idle');
    setAveragingNonce((nonce) => nonce + 1);
  }, []);

  const saveAveragedPoint = useCallback((point: AveragedLandmarkPoint) => {
    setIsAveragingOpen(false);
    setAveragingPhase('idle');
    setAveragingNonce((nonce) => nonce + 1);
    onSaveAveragedPoint(point);
  }, [onSaveAveragedPoint]);

  const collapseAveraging = useCallback(() => {
    setIsAveragingOpen(false);
    setAveragingPhase((phase) => (phase === 'running' ? 'stopped' : phase));
  }, []);
  const stopAveraging = useCallback(() => setAveragingPhase('stopped'), []);
  const requestAveragingReset = useCallback(() => setAveragingResetOpen(true), []);
  const cancelAveragingReset = useCallback(() => setAveragingResetOpen(false), []);

  return {
    isAveragingOpen,
    averagingPhase,
    averaging,
    averagingResetOpen,
    collectPoint,
    startAveraging,
    stopAveraging,
    requestAveragingReset,
    cancelAveragingReset,
    confirmAveragingReset,
    cancelAveraging,
    saveAveragedPoint,
    collapseAveraging,
  };
}

export function useDashboardGpsRecordingActions({
  controller,
  recordingState,
  tracksRevision,
  showToast,
  onSaveAveragedPoint,
  batteryGuard: injectedBatteryGuard,
}: DashboardGpsRecordingActionOptions): DashboardGpsRecordingActionState {
  const batteryGuard = useMemo(
    () => injectedBatteryGuard ?? new BatteryOptimizationGuard(),
    [injectedBatteryGuard],
  );
  const geometry = useCurrentTrackGeometry(controller, recordingState, tracksRevision);
  const recorder = useRecorderActions({ controller, recordingState, showToast, batteryGuard });
  const averaging = useAveragingActions(onSaveAveragedPoint);
  const { closeRecorder } = recorder;
  const { collapseAveraging } = averaging;
  const closeGpsOverlays = useCallback(() => {
    closeRecorder();
    collapseAveraging();
  }, [closeRecorder, collapseAveraging]);

  return {
    ...geometry,
    ...recorder,
    ...averaging,
    closeGpsOverlays,
  };
}
