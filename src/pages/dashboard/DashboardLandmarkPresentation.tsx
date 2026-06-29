import ConfirmDialog from '../../components/ConfirmDialog';
import LandmarkFormModal from '../../components/LandmarkFormModal';
import LongPressRing from '../../components/LongPressRing';
import OverlayMarkerDetailsModal from '../../components/OverlayMarkerDetailsModal';
import { MAP } from '../../constants';
import type { LandmarkCollection } from '../../types/landmark';
import type { NormalizedLandmarkInput } from '../../utils/landmarkMutations';
import type { LandmarkDetails, OverlayMarkerDetails } from '../../utils/overlayMarkerDetails';
import type { LandmarkFormState, LandmarkToastState } from './useDashboardLandmarkActions';

interface LandmarkDetailPresentation {
  value: OverlayMarkerDetails | null;
  onClose: () => void;
  onCreate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

interface LandmarkFormPresentation {
  value: LandmarkFormState | null;
  collections: LandmarkCollection[];
  busy: boolean;
  error: string | null;
  onSubmit: (value: NormalizedLandmarkInput) => void;
  onCancel: () => void;
}

interface LandmarkDeletePresentation {
  target: LandmarkDetails | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface DashboardLandmarkDialogsProps {
  detail: LandmarkDetailPresentation;
  form: LandmarkFormPresentation;
  deletion: LandmarkDeletePresentation;
}

export interface DashboardLandmarkFeedbackProps {
  toast: LandmarkToastState | null;
  longPressRing: { x: number; y: number } | null;
}

function LandmarkForm({ form }: { form: LandmarkFormPresentation }) {
  if (!form.value) return null;
  return (
    <LandmarkFormModal
      isOpen
      mode={form.value.mode}
      initialValues={form.value.initialValues}
      collections={form.collections}
      busy={form.busy}
      submitError={form.error}
      onSubmit={form.onSubmit}
      onCancel={form.onCancel}
    />
  );
}

function LandmarkDeletion({ deletion }: { deletion: LandmarkDeletePresentation }) {
  const name = deletion.target && deletion.target.name !== 'N/A'
    ? deletion.target.name
    : 'this landmark';
  return (
    <ConfirmDialog
      isOpen={deletion.target !== null}
      title="Delete Landmark"
      message={(
        <>
          Are you sure you want to delete{' '}
          <span className="font-semibold text-slate-100">
            {name}
          </span>
          ?
        </>
      )}
      warning="This action cannot be undone."
      confirmLabel="Delete"
      cancelLabel="Cancel"
      danger
      busy={deletion.busy}
      busyLabel={'Deleting\u2026'}
      onConfirm={deletion.onConfirm}
      onCancel={deletion.onCancel}
      testId="delete-landmark-confirm"
    />
  );
}

function LandmarkToast({ toast }: { toast: LandmarkToastState | null }) {
  if (!toast) return null;
  return (
    <div
      data-testid="landmark-toast"
      className={`fixed left-1/2 -translate-x-1/2 bottom-24 z-[10000] px-4 py-2 rounded-lg text-sm text-white shadow-lg ${
        toast.tone === 'success' ? 'bg-emerald-600' : 'bg-red-600'
      }`}
    >
      {toast.message}
    </div>
  );
}

export function DashboardLandmarkDialogs({
  detail,
  form,
  deletion,
}: DashboardLandmarkDialogsProps) {
  return (
    <>
      <OverlayMarkerDetailsModal
        detail={detail.value}
        onClose={detail.onClose}
        onCreateLandmark={detail.onCreate}
        onEditLandmark={detail.onEdit}
        onDeleteLandmark={detail.onDelete}
      />
      <LandmarkForm form={form} />
      <LandmarkDeletion deletion={deletion} />
    </>
  );
}

export function DashboardLandmarkFeedback({
  toast,
  longPressRing,
}: DashboardLandmarkFeedbackProps) {
  return (
    <>
      <LandmarkToast toast={toast} />
      {longPressRing && (
        <LongPressRing
          x={longPressRing.x}
          y={longPressRing.y}
          durationMs={MAP.LONG_PRESS_DURATION_MS - MAP.LONG_PRESS_RING_REVEAL_DELAY_MS}
          sizePx={MAP.LONG_PRESS_RING_SIZE_PX}
          strokePx={MAP.LONG_PRESS_RING_STROKE_PX}
        />
      )}
    </>
  );
}
