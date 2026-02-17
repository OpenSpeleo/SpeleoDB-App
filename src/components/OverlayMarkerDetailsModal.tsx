import React from 'react';
import { IonContent, IonModal } from '@ionic/react';
import type { OverlayMarkerDetails } from '../utils/overlayMarkerDetails';

interface OverlayMarkerDetailsModalProps {
  detail: OverlayMarkerDetails | null;
  onClose: () => void;
}

const OverlayMarkerDetailsModal: React.FC<OverlayMarkerDetailsModalProps> = ({
  detail,
  onClose,
}) => {
  if (!detail) {
    return null;
  }

  return (
    <IonModal
      isOpen
      onDidDismiss={onClose}
      canDismiss
      backdropDismiss
    >
      <IonContent className="ion-padding">
        <div
          data-testid="overlay-marker-details-modal"
          className="flex flex-col h-full justify-center max-w-sm mx-auto text-left"
        >
          <div className="mb-5 text-center">
            <h2 className="text-xl font-semibold text-slate-100 mb-2">
              {detail.type === 'explorationLead' ? 'Exploration Lead' : 'Cylinder Install'}
            </h2>
            <p className="text-slate-400 text-sm">
              Read-only marker details
            </p>
          </div>

          {detail.type === 'explorationLead' ? (
            <div className="rounded-xl border border-slate-700/70 bg-slate-900/50 p-4 mb-5">
              <p className="text-xs uppercase tracking-wide text-slate-400 mb-2">Description</p>
              <p data-testid="overlay-marker-description" className="text-sm text-slate-100">
                {detail.description}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-700/70 bg-slate-900/50 p-4 mb-5 space-y-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">Pressure</p>
                <p data-testid="overlay-marker-pressure" className="text-sm text-slate-100">
                  {detail.pressure}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">Gas mix</p>
                <p data-testid="overlay-marker-gas-mix" className="text-sm text-slate-100">
                  {detail.gasMix}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">Install date</p>
                <p data-testid="overlay-marker-install-date" className="text-sm text-slate-100">
                  {detail.installDate}
                </p>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-3 rounded-xl bg-slate-800/70 text-slate-200 hover:bg-slate-700/70 transition-colors"
          >
            Close
          </button>
        </div>
      </IonContent>
    </IonModal>
  );
};

export default OverlayMarkerDetailsModal;
