import React from 'react';
import { IonContent, IonModal } from '@ionic/react';

interface ReconnectFailedModalProps {
  isOpen: boolean;
  onDismiss: () => void;
}

const ReconnectFailedModal: React.FC<ReconnectFailedModalProps> = ({
  isOpen,
  onDismiss,
}) => (
  <IonModal
    isOpen={isOpen}
    onDidDismiss={onDismiss}
    data-testid="reconnect-failed-modal"
  >
    <IonContent className="ion-padding">
      <div className="flex flex-col h-full justify-center max-w-sm mx-auto text-center">
        <div className="mb-6">
          <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-500/20 text-amber-400 mb-4">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M18.364 5.636a9 9 0 010 12.728m-12.728 0a9 9 0 010-12.728m9.9 2.829a5 5 0 010 7.07m-7.072 0a5 5 0 010-7.07M12 12h.01"
              />
            </svg>
          </span>
          <h2 className="text-xl font-semibold text-slate-100 mb-2">Couldn&apos;t reconnect</h2>
          <p className="text-slate-300 text-sm mb-2">
            We could not reach the SpeleoDB server. You are still in offline mode.
          </p>
          <p className="text-slate-400 text-sm">
            Check your connection and try again, or keep working with your cached data.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3">
          <button
            type="button"
            onClick={onDismiss}
            data-testid="reconnect-failed-dismiss"
            className="app-btn app-btn--secondary touch-manipulation"
          >
            OK
          </button>
        </div>
      </div>
    </IonContent>
  </IonModal>
);

export default ReconnectFailedModal;
