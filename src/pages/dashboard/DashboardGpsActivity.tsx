import ConfirmDialog from '../../components/ConfirmDialog';
import GpsAveragingModal from '../../components/GpsAveragingModal';
import type { GpsAveragingModalProps } from '../../components/GpsAveragingModal';
import GpsRecordingScreen from '../../components/GpsRecordingScreen';
import type { GpsRecordingScreenProps } from '../../components/GpsRecordingScreen';

export interface DashboardGpsActivityProps {
  recording: GpsRecordingScreenProps;
  recordingCancelOpen: boolean;
  onConfirmRecordingCancel: () => void;
  onDismissRecordingCancel: () => void;
  averaging: GpsAveragingModalProps;
  averagingResetOpen: boolean;
  onConfirmAveragingReset: () => void;
  onCancelAveragingReset: () => void;
}

export function DashboardGpsActivity({
  recording,
  recordingCancelOpen,
  onConfirmRecordingCancel,
  onDismissRecordingCancel,
  averaging,
  averagingResetOpen,
  onConfirmAveragingReset,
  onCancelAveragingReset,
}: DashboardGpsActivityProps) {
  return (
    <>
      <GpsRecordingScreen {...recording} />
      <ConfirmDialog
        isOpen={recordingCancelOpen}
        title="Discard recording"
        message="This stops the current recording and discards the track. This cannot be undone."
        confirmLabel="Discard"
        cancelLabel="Keep recording"
        danger
        onConfirm={onConfirmRecordingCancel}
        onCancel={onDismissRecordingCancel}
        testId="gps-recording-cancel-confirm"
      />
      <GpsAveragingModal {...averaging} />
      <ConfirmDialog
        isOpen={averagingResetOpen}
        title="Reset GPS Point"
        message="This clears all the GPS readings collected so far and starts the average over from zero."
        confirmLabel="Reset"
        cancelLabel="Cancel"
        danger
        onConfirm={onConfirmAveragingReset}
        onCancel={onCancelAveragingReset}
        testId="gps-averaging-reset-confirm"
      />
    </>
  );
}
