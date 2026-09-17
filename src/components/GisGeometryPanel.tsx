import { IonToggle } from '@ionic/react';
import { DashboardSidePanel } from './DashboardSidePanel';
import type { GisGeometryMetadata, GisGeometrySnapshot } from '../types/gisGeometry';

export interface GisGeometryPanelProps {
  isOpen: boolean;
  onClose(): void;
  snapshot: GisGeometrySnapshot;
  offline: boolean;
  visibility: Readonly<Record<string, boolean>>;
  visibleCount: number;
  onToggle(id: string, visible: boolean): void;
  onZoom(id: string): void;
  onRetry(id: string): void;
  onRefresh(): void;
  onShowAll(): void;
  onHideAll(): void;
}

function GeometryRow({ item, props }: { item: GisGeometryMetadata; props: GisGeometryPanelProps }) {
  const { snapshot, visibility, onZoom, onToggle, onRetry } = props;
  const individualOn = visibility[item.id] === true;
  const effectiveOn = individualOn && snapshot.records[item.id]?.detail.revision === item.revision;
  const loading = individualOn && snapshot.loadingIds.includes(item.id);
  const error = individualOn ? snapshot.errors[item.id] : undefined;
  return (
    <li className="hover:bg-slate-700/30 transition-colors" data-testid={`gis-geometry-${item.id}`}>
      <div className="flex items-center gap-2 pl-4 pr-3 py-2.5">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onZoom(item.id)}
            title={`Zoom to ${item.name}`}
            aria-label={`Zoom to ${item.name}`}
            className="flex min-w-0 w-full items-center gap-3 text-left"
            data-testid={`gis-geometry-zoom-${item.id}`}
          >
            <span
              aria-hidden="true"
              className="w-3 h-3 rounded-full flex-shrink-0 ring-1 ring-white/20"
              style={{ backgroundColor: effectiveOn ? item.color : 'transparent', borderWidth: effectiveOn ? 0 : 2, borderColor: item.color, borderStyle: 'solid' }}
            />
            <div className="min-w-0 flex-1">
              <span className={`block text-sm truncate ${effectiveOn ? 'text-slate-100' : 'text-slate-500'}`}>{item.name}</span>
            </div>
          </button>
        </div>
        {loading && <span role="status" aria-label={`Loading ${item.name}`} className="h-4 w-4 shrink-0 rounded-full border-2 border-slate-500 border-t-transparent animate-spin" />}
        <IonToggle
          checked={individualOn}
          onIonChange={(event) => {
            if (event.detail.checked !== individualOn) onToggle(item.id, event.detail.checked);
          }}
          aria-label={`Toggle ${item.name}`}
          data-testid={`gis-geometry-toggle-${item.id}`}
        />
      </div>
      {error && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2 text-xs">
          <span role="alert" className="text-red-300">{error}</span>
          <button type="button" className="app-btn app-btn--compact app-btn--secondary" aria-label={`Retry ${item.name}`} onClick={() => onRetry(item.id)}>Retry</button>
        </div>
      )}
    </li>
  );
}

export function GisGeometryPanel(props: GisGeometryPanelProps) {
  const { isOpen, onClose, snapshot, offline, visibleCount, onShowAll, onHideAll, onRefresh } = props;
  const loading = snapshot.status === 'loading' || snapshot.status === 'idle';
  return (
    <DashboardSidePanel
      isOpen={isOpen} onClose={onClose} title="Geometries" testId="gis-geometry-panel"
      subtitle={`${visibleCount} of ${snapshot.items.length} visible`}
    >
      <div className="shrink-0 border-b border-slate-700/50 px-4 py-2">
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="app-btn app-btn--compact app-btn--primary touch-manipulation" aria-label="Show all geometries" onClick={onShowAll} disabled={!snapshot.items.length}>Show all</button>
          <button type="button" className="app-btn app-btn--compact app-btn--secondary touch-manipulation" aria-label="Hide all geometries" onClick={onHideAll} disabled={!snapshot.items.length}>Hide all</button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain" data-testid="gis-geometry-panel-list">
        {snapshot.error && (
          <div className="px-4 py-3">
            <p role="alert" className="mb-2 text-sm text-red-300">{snapshot.error}</p>
            <button type="button" className="app-btn app-btn--compact app-btn--secondary" disabled={loading || offline} aria-label="Retry geometries" onClick={onRefresh}>Retry</button>
          </div>
        )}
        {loading && !snapshot.items.length && <p role="status" className="px-4 py-3 text-sm text-slate-400">Loading geometries…</p>}
        {!snapshot.items.length && !loading && !snapshot.error && (
          <p className="px-4 py-8 text-center text-sm text-slate-500">{offline ? 'No geometries saved on this device.' : 'No geometries available.'}</p>
        )}
        <ul className="py-1">
          {snapshot.items.map(item => <GeometryRow key={item.id} item={item} props={props} />)}
        </ul>
      </div>
    </DashboardSidePanel>
  );
}
