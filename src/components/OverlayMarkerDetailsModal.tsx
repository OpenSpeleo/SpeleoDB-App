import React from 'react';
import { IonContent, IonModal } from '@ionic/react';
import type { OverlayMarkerDetails } from '../utils/overlayMarkerDetails';

interface OverlayMarkerDetailsModalProps {
  detail: OverlayMarkerDetails | null;
  onClose: () => void;
}

const TITLE_BY_TYPE: Record<OverlayMarkerDetails['type'], string> = {
  explorationLead: 'Exploration Lead',
  cylinderInstall: 'Cylinder Install',
  subsurfaceStation: 'Subsurface Station',
  surfaceStation: 'Surface Station',
  landmark: 'Landmark',
  projectPoint: 'Project Entry Point',
  mapLongPress: 'Map Point',
};

function DetailField({ label, testId, value }: {
  label: string;
  testId: string;
  value: string;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">{label}</p>
      <p data-testid={testId} className="text-sm text-slate-100">{value}</p>
    </div>
  );
}

function DetailCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-700/70 bg-slate-900/50 p-4 mb-5 space-y-3">
      {children}
    </div>
  );
}

function renderDetailFields(detail: OverlayMarkerDetails) {
  switch (detail.type) {
    case 'explorationLead':
      return (
        <DetailCard>
          <DetailField label="Description" testId="overlay-marker-description" value={detail.description} />
        </DetailCard>
      );

    case 'cylinderInstall':
      return (
        <DetailCard>
          <DetailField label="Pressure" testId="overlay-marker-pressure" value={detail.pressure} />
          <DetailField label="Gas mix" testId="overlay-marker-gas-mix" value={detail.gasMix} />
          <DetailField label="Install date" testId="overlay-marker-install-date" value={detail.installDate} />
        </DetailCard>
      );

    case 'subsurfaceStation':
      return (
        <DetailCard>
          <DetailField label="Name" testId="overlay-marker-name" value={detail.name} />
          <DetailField label="Description" testId="overlay-marker-description" value={detail.description} />
          <DetailField label="Tag" testId="overlay-marker-tag" value={detail.tag} />
        </DetailCard>
      );

    case 'surfaceStation':
      return (
        <DetailCard>
          <DetailField label="Name" testId="overlay-marker-name" value={detail.name} />
          <DetailField label="Description" testId="overlay-marker-description" value={detail.description} />
          <DetailField label="GPS coordinate" testId="overlay-marker-gps" value={detail.gpsCoordinate} />
        </DetailCard>
      );

    case 'landmark':
      return (
        <DetailCard>
          <DetailField label="Name" testId="overlay-marker-name" value={detail.name} />
          <DetailField label="Description" testId="overlay-marker-description" value={detail.description} />
          <DetailField label="GPS coordinate" testId="overlay-marker-gps" value={detail.gpsCoordinate} />
        </DetailCard>
      );

    case 'projectPoint':
      return (
        <DetailCard>
          <DetailField label="Project" testId="overlay-marker-project-name" value={detail.projectName} />
          <DetailField label="Name" testId="overlay-marker-name" value={detail.name} />
          <DetailField label="GPS coordinate" testId="overlay-marker-gps" value={detail.gpsCoordinate} />
        </DetailCard>
      );

    case 'mapLongPress':
      return (
        <DetailCard>
          <DetailField label="GPS coordinate" testId="overlay-marker-gps" value={detail.gpsCoordinate} />
        </DetailCard>
      );
  }
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
              {TITLE_BY_TYPE[detail.type]}
            </h2>
            <p className="text-slate-400 text-sm">
              Read-only marker details
            </p>
          </div>

          {renderDetailFields(detail)}

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
