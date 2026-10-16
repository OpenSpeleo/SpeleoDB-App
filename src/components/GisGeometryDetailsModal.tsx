import { IonContent, IonModal } from '@ionic/react';
import type { GisGeometryMetadata, GisGeometrySnapshot } from '../types/gisGeometry';

interface Props {
  item?: GisGeometryMetadata;
  snapshot: GisGeometrySnapshot;
  onClose(): void;
  onRetry(id: string): void;
}

/** Read-only details use the same revision and access authority as the map. */
export function GisGeometryDetailsModal({ item, snapshot, onClose, onRetry }: Props) {
  const record = item ? snapshot.records[item.id] : undefined;
  const detail = record?.detail.revision === item?.revision ? record?.detail : undefined;
  const loading = !!item && snapshot.loadingIds.includes(item.id);
  const error = item ? snapshot.errors[item.id] : undefined;
  return (
    <IonModal isOpen={!!item} onDidDismiss={onClose}>
      <IonContent>
        <div className="p-5" data-testid="gis-geometry-details">
          <h2 className="text-xl font-semibold mb-4">{item?.name}</h2>
          <dl className="space-y-3">
            <div><dt className="text-sm text-slate-400">Alias</dt><dd>{item?.alias || 'No alias'}</dd></div>
            <div><dt className="text-sm text-slate-400">Description</dt>
              <dd className="whitespace-pre-wrap break-words">{record?.needsMetadataRefresh ? 'Description not yet available. Connect online to refresh.'
                : detail ? detail.description || 'No description' : loading ? 'Loading…' : 'Description unavailable.'}</dd>
            </div>
          </dl>
          {error && <div className="mt-4">
            <p role="alert">{error}</p>
            <button type="button" className="app-btn app-btn--secondary mt-2" disabled={loading}
              onClick={() => { if (item) onRetry(item.id); }}>Retry</button>
          </div>}
          <button type="button" className="app-btn app-btn--secondary mt-5" onClick={onClose}>Close</button>
        </div>
      </IonContent>
    </IonModal>
  );
}
