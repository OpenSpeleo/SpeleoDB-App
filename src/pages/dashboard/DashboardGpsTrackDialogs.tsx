import { IonContent, IonModal } from '@ionic/react';
import ConfirmDialog from '../../components/ConfirmDialog';
import type { GpsTrackListItem } from '../../types/gpsTrack';
import { TRACK_COLOR_PALETTE, readableInkColor } from '../../utils/gpsTrackColors';

interface GpsUploadDialogProps {
  target: GpsTrackListItem | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function GpsUploadDialog({ target, busy, onConfirm, onCancel }: GpsUploadDialogProps) {
  return (
    <ConfirmDialog
      isOpen={target !== null}
      title="Upload GPS Track"
      message={
        <>
          Upload <span className="font-semibold text-slate-100">{target?.name ?? 'this track'}</span>{' '}
          to SpeleoDB?
        </>
      }
      warning="This sends the GPX track to the active SpeleoDB instance. If you are offline, it will be queued and uploaded after reconnect."
      confirmLabel="Upload"
      cancelLabel="Cancel"
      busy={busy}
      busyLabel={'Uploading\u2026'}
      onConfirm={onConfirm}
      onCancel={onCancel}
      testId="gps-upload-confirm"
    />
  );
}

type GpsDeleteDialogProps = GpsUploadDialogProps;

function GpsDeleteDialog({ target, busy, onConfirm, onCancel }: GpsDeleteDialogProps) {
  const isRemote = target?.origin === 'remote';
  return (
    <ConfirmDialog
      isOpen={target !== null}
      title="Delete GPS Track"
      message={
        <>
          Are you sure you want to delete{' '}
          <span className="font-semibold text-slate-100">{target?.name ?? 'this track'}</span>
          {isRemote ? ' from SpeleoDB' : ''}?
        </>
      }
      warning={
        isRemote
          ? 'This removes the track from SpeleoDB. If you are offline it is queued in Pending changes.'
          : 'This removes the recording from this device. This action cannot be undone.'
      }
      confirmLabel="Delete"
      cancelLabel="Cancel"
      danger
      busy={busy}
      busyLabel={'Deleting\u2026'}
      onConfirm={onConfirm}
      onCancel={onCancel}
      testId="gps-delete-confirm"
    />
  );
}

interface GpsColorPickerProps {
  selectedColor: string;
  onChange: (color: string) => void;
}

function GpsColorPicker({ selectedColor, onChange }: GpsColorPickerProps) {
  return (
    <div className="grid grid-cols-10 gap-2.5" data-testid="gps-edit-color-swatches">
      {TRACK_COLOR_PALETTE.map((color) => {
        const selected = String(selectedColor).toLowerCase() === color.toLowerCase();
        return (
          <button
            key={color}
            type="button"
            aria-label={`Color ${color}`}
            aria-pressed={selected}
            onClick={() => onChange(color)}
            data-testid={`gps-edit-color-${color}`}
            className="relative flex aspect-square w-full items-center justify-center rounded-full transition-transform"
            style={{
              backgroundColor: color,
              transform: selected ? 'scale(1.12)' : undefined,
              boxShadow: selected
                ? '0 0 0 2px #0f172a, 0 0 0 4px #f8fafc'
                : undefined,
            }}
          >
            {selected && (
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5"
                fill="none"
                stroke={readableInkColor(color)}
                strokeWidth={3.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface GpsEditModalProps {
  target: GpsTrackListItem | null;
  name: string;
  color: string;
  busy: boolean;
  onNameChange: (name: string) => void;
  onColorChange: (color: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function GpsEditModal({
  target,
  name,
  color,
  busy,
  onNameChange,
  onColorChange,
  onConfirm,
  onCancel,
}: GpsEditModalProps) {
  if (!target) return null;
  return (
    <IonModal isOpen onDidDismiss={onCancel}>
      <IonContent className="ion-padding">
        <div
          data-testid="gps-edit-modal"
          className="flex flex-col h-full max-w-sm mx-auto"
          style={{ paddingTop: 'calc(3.5rem + var(--safe-area-inset-top, env(safe-area-inset-top, 0px)))' }}
        >
          <h2 className="text-xl font-semibold text-slate-100 mb-5 text-center">
            Edit GPS Track
          </h2>
          <label className="text-xs font-medium text-slate-400 mb-1">Name</label>
          <input
            type="text"
            value={name}
            maxLength={120}
            autoFocus
            onChange={(event) => onNameChange(event.target.value)}
            data-testid="gps-edit-name-input"
            className="w-full px-4 py-2.5 text-sm text-slate-200 bg-transparent border border-slate-700 rounded-lg focus:outline-none focus:border-purple-500 transition-colors placeholder:text-slate-500"
            placeholder="Track name"
          />
          <label className="text-xs font-medium text-slate-400 mt-4 mb-2">Color</label>
          <GpsColorPicker selectedColor={color} onChange={onColorChange} />
          <div className="grid grid-cols-2 gap-3 mt-6">
            <button
              type="button"
              onClick={onCancel}
              data-testid="gps-edit-cancel"
              className="app-btn app-btn--secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              data-testid="gps-edit-save"
              className="app-btn app-btn--primary"
            >
              {busy ? 'Saving\u2026' : 'Save'}
            </button>
          </div>
        </div>
      </IonContent>
    </IonModal>
  );
}

export interface DashboardGpsTrackDialogsProps {
  uploadTarget: GpsTrackListItem | null;
  uploadBusy: boolean;
  onConfirmUpload: () => void;
  onCancelUpload: () => void;
  deleteTarget: GpsTrackListItem | null;
  deleteBusy: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  editTarget: GpsTrackListItem | null;
  editName: string;
  editColor: string;
  editBusy: boolean;
  onEditNameChange: (name: string) => void;
  onEditColorChange: (color: string) => void;
  onConfirmEdit: () => void;
  onCancelEdit: () => void;
}

export function DashboardGpsTrackDialogs(props: DashboardGpsTrackDialogsProps) {
  return (
    <>
      <GpsUploadDialog
        target={props.uploadTarget}
        busy={props.uploadBusy}
        onConfirm={props.onConfirmUpload}
        onCancel={props.onCancelUpload}
      />
      <GpsDeleteDialog
        target={props.deleteTarget}
        busy={props.deleteBusy}
        onConfirm={props.onConfirmDelete}
        onCancel={props.onCancelDelete}
      />
      <GpsEditModal
        target={props.editTarget}
        name={props.editName}
        color={props.editColor}
        busy={props.editBusy}
        onNameChange={props.onEditNameChange}
        onColorChange={props.onEditColorChange}
        onConfirm={props.onConfirmEdit}
        onCancel={props.onCancelEdit}
      />
    </>
  );
}
