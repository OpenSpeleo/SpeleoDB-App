/**
 * LandmarkPanel -- collapsible side panel for browsing landmarks by collection.
 *
 * Read-only mirror of the web map viewer's "Landmark Manager". Slides in from
 * the left over the map (same visual language as `ProjectPanel`). Landmarks are
 * grouped by collection; each collection header carries a color swatch, an
 * optional "Private" badge, a count, and a per-collection visibility toggle.
 * Each landmark row locates (flies) to its position and opens its details.
 *
 * Fully offline: every group is derived from the cached landmarks GeoJSON via
 * `buildLandmarkCollectionGroups`. The panel is stateless -- data and callbacks
 * come in via props.
 */

import React from 'react';
import { IonToggle } from '@ionic/react';
import type {
  LandmarkCollectionGroup,
  LandmarkListItem,
} from '../utils/landmarkCollections';

// ==================== Props ====================

export interface LandmarkPanelProps {
  groups: LandmarkCollectionGroup[];
  collectionVisibility: Record<string, boolean>;
  collectionCollapsed: Record<string, boolean>;
  onToggleCollection: (collectionId: string, visible: boolean) => void;
  onToggleCollectionCollapsed: (collectionId: string, collapsed: boolean) => void;
  onLocateLandmark: (landmark: LandmarkListItem) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  onClose: () => void;
  isOpen: boolean;
}

// ==================== Helpers ====================

function isCollectionOn(
  collectionId: string,
  collectionVisibility: Record<string, boolean>,
): boolean {
  return collectionVisibility[collectionId] !== false;
}

function isCollectionCollapsed(
  collectionId: string,
  collectionCollapsed: Record<string, boolean>,
): boolean {
  return collectionCollapsed[collectionId] === true;
}

function formatCoordinate(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

// ==================== Collection header ====================

interface CollectionHeaderProps {
  group: LandmarkCollectionGroup;
  collectionOn: boolean;
  collapsed: boolean;
  onToggleCollection: (collectionId: string, visible: boolean) => void;
  onToggleCollapsed: (collectionId: string, collapsed: boolean) => void;
}

const CollectionHeader: React.FC<CollectionHeaderProps> = ({
  group,
  collectionOn,
  collapsed,
  onToggleCollection,
  onToggleCollapsed,
}) => {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 cursor-pointer
                 hover:bg-slate-700/30 transition-colors select-none"
      onClick={() => onToggleCollapsed(group.id, !collapsed)}
      data-testid={`collection-collapse-${group.id}`}
    >
      <svg
        className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200
                    ${collapsed ? '-rotate-90' : 'rotate-0'}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 9l-7 7-7-7"
        />
      </svg>
      <span
        data-testid={`collection-color-dot-${group.id}`}
        className="w-3 h-3 rounded-full flex-shrink-0 ring-1 ring-white/20"
        style={{ backgroundColor: group.color }}
      />
      <span className="min-w-0 flex-1 text-xs font-semibold text-slate-200 truncate">
        {group.name}
      </span>
      {group.isPersonal && (
        <span
          data-testid={`collection-private-badge-${group.id}`}
          className="rounded-full bg-slate-700 px-2 py-0.5 text-[9px] uppercase tracking-wide text-slate-300"
        >
          Private
        </span>
      )}
      <span className="text-[10px] text-slate-500">({group.count})</span>
      <div
        // The toggle must not bubble into the header click, otherwise tapping
        // the toggle would also collapse the section.
        onClick={(e) => e.stopPropagation()}
      >
        <IonToggle
          checked={collectionOn}
          onIonChange={(e) => {
            if (e.detail.checked !== collectionOn) {
              onToggleCollection(group.id, e.detail.checked);
            }
          }}
          data-testid={`collection-toggle-${group.id}`}
          aria-label={`Toggle collection ${group.name}`}
        />
      </div>
    </div>
  );
};

// ==================== Component ====================

const LandmarkPanel: React.FC<LandmarkPanelProps> = ({
  groups,
  collectionVisibility,
  collectionCollapsed,
  onToggleCollection,
  onToggleCollectionCollapsed,
  onLocateLandmark,
  onShowAll,
  onHideAll,
  onClose,
  isOpen,
}) => {
  const totalCount = groups.reduce((sum, group) => sum + group.count, 0);
  const visibleCount = groups.reduce(
    (sum, group) =>
      isCollectionOn(group.id, collectionVisibility) ? sum + group.count : sum,
    0,
  );

  const renderLandmarkRow = (
    landmark: LandmarkListItem,
    collectionOn: boolean,
  ): React.ReactNode => (
    <li key={landmark.id} className="hover:bg-slate-700/30 transition-colors">
      <div className="flex items-center gap-2 pl-4 pr-3 py-2.5">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onLocateLandmark(landmark)}
            className="flex min-w-0 w-full items-center gap-3 text-left"
            title={`Locate ${landmark.name}`}
            data-testid={`landmark-row-${landmark.id}`}
          >
            <span
              className="w-3 h-3 rounded-full flex-shrink-0 ring-1 ring-white/20"
              style={{
                backgroundColor: collectionOn ? landmark.collectionColor : 'transparent',
                borderWidth: collectionOn ? 0 : 2,
                borderColor: landmark.collectionColor,
                borderStyle: 'solid',
              }}
            />
            <div className="min-w-0 flex-1">
              <span
                className={`block text-sm truncate ${
                  collectionOn ? 'text-slate-100' : 'text-slate-500'
                }`}
              >
                {landmark.name}
              </span>
              <span className="block text-[10px] text-slate-500 truncate">
                {formatCoordinate(landmark.latitude, landmark.longitude)}
              </span>
            </div>
          </button>
        </div>
        <svg
          className="w-5 h-5 text-slate-500 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
          />
        </svg>
      </div>
    </li>
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 z-20 bg-black/40 transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`absolute top-0 left-0 bottom-0 z-30 w-72 max-w-[80vw]
          bg-slate-900/95 backdrop-blur-md border-r border-slate-700/50
          flex flex-col transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ paddingTop: 'var(--safe-area-inset-top, env(safe-area-inset-top))' }}
        data-testid="landmark-panel"
      >
        {/* Header */}
        <div className="shrink-0 border-b border-slate-700/50 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-100">Landmarks</h2>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400
                         hover:bg-slate-700/50 hover:text-slate-100 transition-colors"
              aria-label="Close panel"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            {visibleCount} of {totalCount} visible
          </p>
        </div>

        {/* Bulk actions */}
        <div className="shrink-0 border-b border-slate-700/50 px-4 py-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onShowAll}
              aria-label="Show all collections"
              className="app-btn app-btn--compact app-btn--primary touch-manipulation"
            >
              Show all
            </button>
            <button
              type="button"
              onClick={onHideAll}
              aria-label="Hide all collections"
              className="app-btn app-btn--compact app-btn--secondary touch-manipulation"
            >
              Hide all
            </button>
          </div>
        </div>

        {/* Collection list */}
        <div
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain"
          data-testid="landmark-panel-list"
        >
          {groups.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              No landmarks available
            </div>
          ) : (
            <ul className="py-1">
              {groups.map((group) => {
                const collectionOn = isCollectionOn(group.id, collectionVisibility);
                const collapsed = isCollectionCollapsed(group.id, collectionCollapsed);
                return (
                  <li key={`collection-${group.id}`} data-testid={`collection-group-${group.id}`}>
                    <CollectionHeader
                      group={group}
                      collectionOn={collectionOn}
                      collapsed={collapsed}
                      onToggleCollection={onToggleCollection}
                      onToggleCollapsed={onToggleCollectionCollapsed}
                    />
                    {!collapsed && (
                      <ul className="pl-3">
                        {group.landmarks.map((landmark) =>
                          renderLandmarkRow(landmark, collectionOn),
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
};

export default LandmarkPanel;
