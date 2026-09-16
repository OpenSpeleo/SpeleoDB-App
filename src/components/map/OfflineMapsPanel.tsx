import { useEffect, useRef, useState, type RefObject } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import type { SpeleoDBController } from '../../controllers/SpeleoDBController';
import {
  DownloadAreaType,
  type DownloadArea,
  type DownloadAreasSnapshot,
} from '../../types/downloadArea';
import { downloadAreaColor } from '../../services/downloadAreaColors';
import { areaMapBounds } from '../../services/downloadAreaGeometry';
import { zoomToMapBounds } from '../../utils/mapCamera';
import { OfflineAreaEditor } from './OfflineAreaEditor';
import { OfflineAreaList } from './OfflineAreaList';
import './offlineMaps.css';

const STATUS_LABELS = {
  queued: 'Queued',
  planning: 'Preparing…',
  downloading: 'Downloading',
  downloaded: 'Downloaded',
  waiting: 'Waiting for connection',
  'storage-blocked': 'Storage full',
  incomplete: 'Download incomplete',
  'too-large': 'Area too large',
};
export interface OfflineMapsPanelProps {
  controller: SpeleoDBController;
  snapshot: DownloadAreasSnapshot;
  mapRef: RefObject<MapRef | null>;
  offline: boolean;
  onClose(): void;
  onEditingChange(editing: boolean): void;
}
export function OfflineMapsPanel({
  controller,
  snapshot,
  mapRef,
  offline,
  onClose,
  onEditingChange,
}: OfflineMapsPanelProps) {
  const [editor, setEditor] = useState<DownloadArea | 'new' | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pendingAreas, setPendingAreas] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const manual = snapshot.areas.filter(
    (area) => area.type === DownloadAreaType.Manual,
  );
  // The catalog commits before tile cleanup finishes. Once an area disappears,
  // its remaining cleanup must not block actions on the areas still in the list.
  const busy = manual.some((area) => pendingAreas.has(area.areaId));
  const confirmingDelete = manual.some((area) => area.areaId === deleting);
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  useEffect(() => () => onEditingChange(false), [onEditingChange]);
  const changeEditor = (next: DownloadArea | 'new' | null) => {
    // Batch the dashboard layout change with the editor mount. Measuring first
    // and hiding the tab bar in a later effect produces two different viewports.
    onEditingChange(next !== null);
    setEditor(next);
  };
  const run = async (areaId: string, work: () => Promise<unknown>) => {
    setPendingAreas((current) => new Set(current).add(areaId));
    setError(null);
    try {
      await work();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Unable to update this area.',
      );
    } finally {
      setPendingAreas((current) => {
        const next = new Set(current);
        next.delete(areaId);
        return next;
      });
    }
  };
  if (editor)
    return (
      <OfflineAreaEditor
        initial={editor === 'new' ? undefined : editor}
        mapRef={mapRef}
        offline={offline}
        layerCount={snapshot.enabledLayerIds.length}
        onCancel={() => changeEditor(null)}
        onSave={async (input) => {
          await controller.saveDownloadArea(
            input,
            editor === 'new' ? undefined : editor.areaId,
          );
          changeEditor(null);
        }}
      />
    );
  return (
    <section
      ref={panelRef}
      className="offline-map-sheet offline-map-manager"
      role="dialog"
      aria-label="Offline Maps"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) {
          if (confirmingDelete) setDeleting(null);
          else onClose();
        }
      }}
    >
      <div className="offline-map-heading">
        <h2>Offline Maps</h2>
        <button
          ref={closeRef}
          className="app-btn app-btn--secondary offline-map-icon"
          aria-label="Close"
          onClick={onClose}
          disabled={busy}
        >
          <AreaIcon kind="close" />
        </button>
      </div>
      <button
        className="app-btn app-btn--primary offline-map-primary"
        disabled={busy || confirmingDelete}
        onClick={() => {
          setError(null);
          changeEditor('new');
        }}
      >
        Add new offline area
      </button>
      {!manual.length && (
        <p className="offline-map-secondary">
          Choose an area on the map to keep offline.
        </p>
      )}
      <OfflineAreaList>
        {(error || snapshot.error) && (
          <p role="alert">{error ?? snapshot.error}</p>
        )}
        {manual.map((area, index) => {
          const label = `Area ${index + 1}`;
          const progress = snapshot.progress[area.areaId];
          const status = progress?.status ?? (offline ? 'waiting' : 'queued');
          return (
            <div
              className="offline-map-item"
              key={area.areaId}
              role="group"
              aria-label={label}
            >
              <div className="offline-map-row">
                <button
                  type="button"
                  className="offline-map-select"
                  aria-label={`Zoom to ${label}`}
                  disabled={busy || confirmingDelete}
                  onClick={() => {
                    const map = mapRef.current;
                    if (!map) return;
                    zoomToMapBounds(map, areaMapBounds(area), panelRef.current);
                  }}
                >
                  <span
                    className="offline-map-color"
                    style={{ backgroundColor: downloadAreaColor(area) }}
                    aria-hidden="true"
                  />
                  <span className="offline-map-row-main">
                    <strong>{label}</strong>
                    <span aria-live="polite">
                      {STATUS_LABELS[status]}
                      {status === 'downloading' && progress?.totalTiles
                        ? ` · ${Math.floor((progress.completedTiles / progress.totalTiles) * 100)}%`
                        : ''}
                    </span>
                  </span>
                </button>
                <div className="offline-map-row-actions">
                  <button
                    className="app-btn app-btn--secondary offline-map-icon"
                    aria-label={`Edit ${label}`}
                    disabled={busy || confirmingDelete}
                    onClick={() => {
                      setError(null);
                      changeEditor(area);
                    }}
                  >
                    <AreaIcon kind="edit" />
                  </button>
                  <button
                    className="app-btn app-btn--secondary offline-map-icon offline-map-delete"
                    aria-label={`Delete ${label}`}
                    disabled={busy || confirmingDelete}
                    onClick={() => {
                      setError(null);
                      setDeleting(area.areaId);
                    }}
                  >
                    <AreaIcon kind="delete" />
                  </button>
                </div>
              </div>
              {deleting === area.areaId && (
                <div
                  className="offline-map-confirm"
                  role="group"
                  aria-label={`Delete ${label}?`}
                >
                  <p>Delete this offline area?</p>
                  <div className="offline-map-actions">
                    <button
                      autoFocus
                      className="app-btn app-btn--secondary"
                      disabled={busy}
                      onClick={() => setDeleting(null)}
                    >
                      Cancel
                    </button>
                    <button
                      className="app-btn app-btn--danger"
                      disabled={busy}
                      onClick={() =>
                        void run(area.areaId, async () => {
                          await controller.deleteDownloadArea(area.areaId);
                          setDeleting((current) =>
                            current === area.areaId ? null : current,
                          );
                        })
                      }
                    >
                      Delete area
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </OfflineAreaList>
    </section>
  );
}

function AreaIcon({
  kind,
}: {
  kind: 'edit' | 'delete' | 'close';
}) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === 'edit' ? (
        <>
          <path d="m15 5 4 4M4 20l5-1L20 8a2.8 2.8 0 0 0-4-4L5 15l-1 5Z" />
        </>
      ) : kind === 'delete' ? (
        <>
          <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
        </>
      ) : (
        <path d="m6 6 12 12M6 18 18 6" />
      )}
    </svg>
  );
}
