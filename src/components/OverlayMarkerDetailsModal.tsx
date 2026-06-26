import React, { useCallback } from 'react';
import { IonContent, IonModal } from '@ionic/react';
import { Share } from '@capacitor/share';
import type { OverlayMarkerDetails } from '../utils/overlayMarkerDetails';
import { isShareCancellation } from '../utils/share';

interface OverlayMarkerDetailsModalProps {
  detail: OverlayMarkerDetails | null;
  onClose: () => void;
  /** Open the create-landmark form for a long-pressed map point. */
  onCreateLandmark?: () => void;
  /** Open the edit form for the shown landmark. */
  onEditLandmark?: () => void;
  /** Open the delete confirmation for the shown landmark. */
  onDeleteLandmark?: () => void;
}

const SHAREABLE_TYPES = new Set<OverlayMarkerDetails['type']>(['landmark', 'surfaceStation', 'projectPoint', 'mapLongPress']);

const TITLE_BY_TYPE: Record<OverlayMarkerDetails['type'], string> = {
  explorationLead: 'Exploration Lead',
  cylinderInstall: 'Cylinder Install',
  subsurfaceStation: 'Subsurface Station',
  surfaceStation: 'Surface Station',
  landmark: 'Landmark',
  projectPoint: 'Project Entry Point',
  mapLongPress: 'Map Point',
};

function buildShareText(detail: OverlayMarkerDetails): string {
  const title = TITLE_BY_TYPE[detail.type];
  const lines: string[] = [title];

  switch (detail.type) {
    case 'explorationLead':
      lines.push(detail.description);
      break;
    case 'cylinderInstall':
      lines.push(`Pressure: ${detail.pressure}`);
      lines.push(`Gas mix: ${detail.gasMix}`);
      lines.push(`Install date: ${detail.installDate}`);
      break;
    case 'subsurfaceStation':
      lines.push(`Name: ${detail.name}`);
      if (detail.description) lines.push(detail.description);
      break;
    case 'surfaceStation':
      lines.push(`Name: ${detail.name}`);
      lines.push(`GPS: ${detail.gpsCoordinate}`);
      break;
    case 'landmark':
      lines.push(`Name: ${detail.name}`);
      lines.push(
        `Collection: ${detail.collectionName}${detail.isPersonalCollection ? ' (Private)' : ''}`,
      );
      lines.push(`GPS: ${detail.gpsCoordinate}`);
      break;
    case 'projectPoint':
      lines.push(`Project: ${detail.projectName}`);
      lines.push(`Name: ${detail.name}`);
      lines.push(`GPS: ${detail.gpsCoordinate}`);
      break;
    case 'mapLongPress':
      lines.push(`GPS: ${detail.gpsCoordinate}`);
      break;
  }

  return lines.join('\n');
}

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
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">Collection</p>
            <p className="flex items-center gap-2 text-sm text-slate-100">
              <span data-testid="overlay-marker-collection">{detail.collectionName}</span>
              {detail.isPersonalCollection && (
                <span
                  data-testid="overlay-marker-collection-private"
                  className="rounded-full bg-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300"
                >
                  Private
                </span>
              )}
            </p>
          </div>
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
  onCreateLandmark,
  onEditLandmark,
  onDeleteLandmark,
}) => {
  const handleShare = useCallback(async () => {
    if (!detail) return;
    try {
      await Share.share({
        title: TITLE_BY_TYPE[detail.type],
        text: buildShareText(detail),
      });
    } catch (error) {
      if (isShareCancellation(error)) {
        return;
      }
      console.warn('[overlay-share] Failed to share marker details.', error);
    }
  }, [detail]);

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

          {detail.type === 'mapLongPress' && onCreateLandmark && (
            <button
              type="button"
              onClick={onCreateLandmark}
              data-testid="create-landmark-button"
              className="app-btn app-btn--primary w-full mb-3 gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 4v16m8-8H4" />
              </svg>
              Create Landmark
            </button>
          )}

          {detail.type === 'landmark' && (detail.canWrite || detail.canDelete) && (
            <div className={`grid gap-3 mb-3 ${detail.canWrite && detail.canDelete ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {detail.canWrite && onEditLandmark && (
                <button
                  type="button"
                  onClick={onEditLandmark}
                  data-testid="edit-landmark-button"
                  className="app-btn app-btn--info"
                >
                  Edit Landmark
                </button>
              )}
              {detail.canDelete && onDeleteLandmark && (
                <button
                  type="button"
                  onClick={onDeleteLandmark}
                  data-testid="delete-landmark-button"
                  className="app-btn app-btn--danger"
                >
                  Delete Landmark
                </button>
              )}
            </div>
          )}

          <div className={`grid gap-3 ${SHAREABLE_TYPES.has(detail.type) ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <button
              type="button"
              onClick={onClose}
              className="app-btn app-btn--secondary"
            >
              Close
            </button>
            {SHAREABLE_TYPES.has(detail.type) && (
              <button
                type="button"
                onClick={handleShare}
                data-testid="share-button"
                className="app-btn app-btn--primary gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                Share
              </button>
            )}
          </div>
        </div>
      </IonContent>
    </IonModal>
  );
};

export default OverlayMarkerDetailsModal;
