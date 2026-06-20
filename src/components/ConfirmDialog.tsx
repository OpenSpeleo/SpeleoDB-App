import React from 'react';
import { IonContent, IonModal } from '@ionic/react';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  /** Primary message. Plain text or rich nodes (e.g. a bold landmark name). */
  message: React.ReactNode;
  /** Optional emphasized warning line shown below the message. */
  warning?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as a destructive action. */
  danger?: boolean;
  /** Disable buttons + show a busy label while the confirm action runs. */
  busy?: boolean;
  busyLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}

/**
 * Reusable confirmation modal. Used for destructive actions (e.g. delete a
 * landmark) where an explicit yes/no is required. Mirrors the Settings logout
 * confirmation layout so confirmations feel consistent across the app.
 */
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  warning,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  busyLabel,
  onConfirm,
  onCancel,
  testId = 'confirm-dialog',
}) => {
  return (
    <IonModal
      isOpen={isOpen}
      onDidDismiss={() => {
        if (!busy) onCancel();
      }}
      canDismiss={!busy}
      backdropDismiss={!busy}
    >
      <IonContent className="ion-padding">
        <div
          data-testid={testId}
          className="flex flex-col h-full justify-center max-w-sm mx-auto text-center"
        >
          <div className="mb-6">
            <span
              className={`inline-flex items-center justify-center w-14 h-14 rounded-full mb-4 ${
                danger ? 'bg-red-500/20 text-red-300' : 'bg-blue-500/20 text-blue-400'
              }`}
            >
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-7.938 4h15.876c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L2.33 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </span>
            <h2 className="text-xl font-semibold text-slate-100 mb-2">{title}</h2>
            <div className="text-slate-300 text-sm">{message}</div>
            {warning && (
              <p data-testid={`${testId}-warning`} className="text-amber-400 text-sm mt-3 font-medium">
                {warning}
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              data-testid={`${testId}-cancel`}
              className="app-btn app-btn--secondary"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              data-testid={`${testId}-confirm`}
              className={`app-btn ${danger ? 'app-btn--danger' : 'app-btn--primary'}`}
            >
              {busy ? busyLabel ?? `${confirmLabel}\u2026` : confirmLabel}
            </button>
          </div>
        </div>
      </IonContent>
    </IonModal>
  );
};

export default ConfirmDialog;
