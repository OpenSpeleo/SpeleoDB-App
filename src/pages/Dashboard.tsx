/**
 * Dashboard -- full-screen map with per-project GeoJSON layers.
 *
 * Replaces the old card-based dashboard with a maplibre-gl map.
 * Each project's cached GeoJSON is rendered as a colored layer that
 * can be toggled on/off via the ProjectPanel.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import {
  IonPage,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  IonModal,
} from '@ionic/react';
import Map, { Layer, Source } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import type { LngLatBoundsLike } from 'maplibre-gl';

import { useSpeleoDB } from '../context/SpeleoDBProvider';
import { MAP } from '../constants';
import { registerTileCacheProtocol, getCachedStyle } from '../services/TileCacheService';
import {
  getProjectVisibilityPreferences,
  setProjectVisibilityPreference,
  setProjectVisibilityPreferences,
} from '../services/PreferencesService';
import ProjectPanel from '../components/ProjectPanel';
import { createProjectColorState, getProjectColor } from '../utils/projectColors';

// ==================== GeoJSON type alias ====================

type GeoJsonRecord = Record<string, GeoJSON.FeatureCollection>;

// ==================== Helpers ====================

/**
 * Normalize any valid GeoJSON into a FeatureCollection.
 * Handles: FeatureCollection, Feature, bare Geometry, wrapped payloads,
 * and JSON strings returned by some native transports.
 */
function normalizeGeoJSON(data: unknown): GeoJSON.FeatureCollection | null {
  let current: unknown = data;

  // Unwrap a few common envelope shapes:
  // - raw JSON string
  // - { data: <geojson> }
  // - { geojson: <geojson> }
  // iOS native HTTP responses can surface JSON as strings.
  for (let i = 0; i < 4; i += 1) {
    if (typeof current === 'string') {
      const trimmed = current.trim();
      if (!trimmed) return null;
      try {
        current = JSON.parse(trimmed);
      } catch {
        return null;
      }
      continue;
    }

    if (!current || typeof current !== 'object') break;
    const envelope = current as Record<string, unknown>;

    if (typeof envelope.type === 'string' || Array.isArray(envelope.features)) {
      break;
    }

    if ('data' in envelope) {
      current = envelope.data;
      continue;
    }

    if ('geojson' in envelope) {
      current = envelope.geojson;
      continue;
    }

    break;
  }

  if (!current || typeof current !== 'object') return null;
  const obj = current as Record<string, unknown>;

  // Already a FeatureCollection
  if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
    return obj as unknown as GeoJSON.FeatureCollection;
  }

  // Some payloads omit "type" but still expose a features array.
  if (Array.isArray(obj.features)) {
    return {
      type: 'FeatureCollection',
      features: obj.features as GeoJSON.Feature[],
    };
  }

  // Single Feature → wrap in a FeatureCollection
  if (obj.type === 'Feature') {
    return {
      type: 'FeatureCollection',
      features: [obj as unknown as GeoJSON.Feature],
    };
  }

  // Bare Geometry → wrap in Feature → FeatureCollection
  if (typeof obj.type === 'string' && ('coordinates' in obj || 'geometries' in obj)) {
    return {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: obj as unknown as GeoJSON.Geometry },
      ],
    };
  }

  return null;
}

/** Compute combined bounding box for the given project IDs. */
function computeBounds(
  geoJsonData: GeoJsonRecord,
  ids: Set<string>,
): LngLatBoundsLike | null {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let hasCoords = false;

  for (const id of ids) {
    const fc = geoJsonData[id];
    if (!fc?.features) continue;

    for (const feature of fc.features) {
      if (!feature.geometry) continue;
      visitCoords(feature.geometry, (lng: number, lat: number) => {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        hasCoords = true;
      });
    }
  }

  if (!hasCoords) return null;

  const lngPad = Math.max((maxLng - minLng) * 0.1, 0.01);
  const latPad = Math.max((maxLat - minLat) * 0.1, 0.01);

  return [
    [minLng - lngPad, minLat - latPad],
    [maxLng + lngPad, maxLat + latPad],
  ];
}

/** Walk every coordinate in a GeoJSON geometry. */
function visitCoords(
  geometry: GeoJSON.Geometry,
  fn: (lng: number, lat: number) => void,
): void {
  switch (geometry.type) {
    case 'Point':
      fn(geometry.coordinates[0], geometry.coordinates[1]);
      break;
    case 'MultiPoint':
    case 'LineString':
      for (const c of geometry.coordinates) fn(c[0], c[1]);
      break;
    case 'MultiLineString':
    case 'Polygon':
      for (const ring of geometry.coordinates)
        for (const c of ring) fn(c[0], c[1]);
      break;
    case 'MultiPolygon':
      for (const poly of geometry.coordinates)
        for (const ring of poly)
          for (const c of ring) fn(c[0], c[1]);
      break;
    case 'GeometryCollection':
      for (const g of geometry.geometries) visitCoords(g, fn);
      break;
  }
}

type OrientationLockMap = {
  touchZoomRotate?: { disableRotation?: () => void };
  setBearing?: (bearing: number) => void;
  setPitch?: (pitch: number) => void;
};

/** Keep the map north-up and disable touch rotation. */
function lockMapOrientation(mapRef: MapRef | null): void {
  if (!mapRef) return;

  const map = mapRef.getMap() as unknown as OrientationLockMap;
  map.touchZoomRotate?.disableRotation?.();
  map.setBearing?.(MAP.NORTH_UP_ORIENTATION.bearing);
  map.setPitch?.(MAP.NORTH_UP_ORIENTATION.pitch);
}

// ==================== Register tile caching protocol once ====================

registerTileCacheProtocol();

// ==================== Component ====================

const Dashboard: React.FC = () => {
  const history = useHistory();
  const { controller, projects, syncStatus, tilePrefetchJobs, isOfflineLocked } = useSpeleoDB();
  const didSyncRef = useRef(false);
  const didFitRef = useRef(false);
  const mapRef = useRef<MapRef>(null);

  // Panel state
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [showLogoutConfirmModal, setShowLogoutConfirmModal] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isMapGestureActive, setIsMapGestureActive] = useState(false);

  // Active projects (which layers are visible)
  const [activeProjectIds, setActiveProjectIds] = useState<Set<string>>(new Set());

  // Loaded GeoJSON keyed by project ID
  const [geoJsonData, setGeoJsonData] = useState<GeoJsonRecord>({});

  // Map style (loaded from cache/network)
  const [mapStyle, setMapStyle] = useState<Record<string, unknown> | null>(null);

  // Monotonic counter -- incremented after each sync to trigger a reload.
  const [loadTrigger, setLoadTrigger] = useState(0);

  // ---- Auth guard -----------------------------------------------------------

  useEffect(() => {
    if (!controller.isAuthenticated()) {
      history.push('/login');
    }
  }, [history, controller]);

  // ---- Load map style -------------------------------------------------------

  useEffect(() => {
    getCachedStyle(MAP.STYLE_URL)
      .then(setMapStyle)
      .catch((err) => console.error('Failed to load map style:', err));
  }, []);

  // ---- Sync projects on mount -----------------------------------------------

  useEffect(() => {
    if (!didSyncRef.current) {
      didSyncRef.current = true;
      controller.syncProjects().then(() => {
        setLoadTrigger((n) => n + 1);
      });
    }
  }, [controller]);

  // ---- Load GeoJSON from cache after sync completes -------------------------

  const { sortedProjects, projectColorsById } = useMemo(
    () => createProjectColorState(projects),
    [projects],
  );
  const geoJsonProjects = useMemo(
    () => sortedProjects.filter((p) => !p.exclude_geojson && Boolean(p.geojson_file)),
    [sortedProjects],
  );
  const panelProjects = useMemo(
    () => sortedProjects.filter((p) => Boolean(geoJsonData[p.id])),
    [sortedProjects, geoJsonData],
  );
  const panelActiveProjectIds = useMemo(
    () =>
      new Set(
        [...activeProjectIds].filter((projectId) => Boolean(geoJsonData[projectId])),
      ),
    [activeProjectIds, geoJsonData],
  );
  const tilePrefetchByProject = useMemo(
    () =>
      Object.fromEntries(
        tilePrefetchJobs.map((job) => [job.projectId, job] as const),
      ),
    [tilePrefetchJobs],
  );
  const tilePrefetchSummary = useMemo(() => {
    if (tilePrefetchJobs.length === 0) return null;
    const activeJobs = tilePrefetchJobs.filter(
      (job) => job.status === 'queued' || job.status === 'downloading' || job.status === 'paused',
    );
    if (activeJobs.length === 0) return null;

    const totalTiles = activeJobs.reduce((sum, job) => sum + job.totalTiles, 0);
    const doneTiles = activeJobs.reduce(
      (sum, job) => sum + job.completedTiles + job.failedTiles,
      0,
    );
    const pct = totalTiles > 0 ? Math.floor((doneTiles / totalTiles) * 100) : 0;
    return `${pct}% offline maps`;
  }, [tilePrefetchJobs]);

  useEffect(() => {
    // Only load when triggered (after sync completes)
    if (loadTrigger === 0) return;
    if (geoJsonProjects.length === 0) {
      setGeoJsonData({});
      return;
    }

    let stale = false;

    (async () => {
      const newData: GeoJsonRecord = {};

      for (const project of geoJsonProjects) {
        try {
          const raw = await controller.getProjectGeoJSON(project.id);
          if (stale) return;

          const fc = normalizeGeoJSON(raw);
          if (fc && fc.features.length > 0) {
            newData[project.id] = fc;
          }
        } catch (err) {
          console.warn(`Failed to load GeoJSON for ${project.id}:`, err);
        }
      }

      if (stale) return;

      setGeoJsonData(newData);

      // On first meaningful load, restore persisted visibility per project.
      setActiveProjectIds((prev) => {
        if (prev.size === 0) {
          const visibilityPrefs = getProjectVisibilityPreferences();
          const visibleIds = Object.keys(newData).filter(
            (projectId) => visibilityPrefs[projectId] !== false,
          );
          return new Set(visibleIds);
        }
        return prev;
      });
    })();

    return () => { stale = true; };
  }, [loadTrigger, controller, geoJsonProjects]);

  // ---- Auto-fit bounds on first data load -----------------------------------

  useEffect(() => {
    if (didFitRef.current) return;
    if (activeProjectIds.size === 0 || Object.keys(geoJsonData).length === 0) return;

    const bounds = computeBounds(geoJsonData, activeProjectIds);
    if (bounds && mapRef.current) {
      didFitRef.current = true;
      mapRef.current.fitBounds(bounds, { padding: 50, maxZoom: 14, duration: 800 });
    }
  }, [activeProjectIds, geoJsonData]);

  // ---- Handlers -------------------------------------------------------------

  const handleRefresh = useCallback(async (event: CustomEvent) => {
    didFitRef.current = false;
    if (isOfflineLocked) {
      const result = await controller.retryConnection();
      if (result !== 'ok') {
        event.detail.complete();
        return;
      }
    }
    await controller.syncProjects();
    setLoadTrigger((n) => n + 1);
    event.detail.complete();
  }, [controller, isOfflineLocked]);

  const handleMapGestureStart = useCallback((
    event: React.TouchEvent<HTMLDivElement> | React.PointerEvent<HTMLDivElement>,
  ) => {
    event.stopPropagation();
    setIsMapGestureActive(true);
  }, []);

  const handleMapGestureMove = useCallback((
    event: React.TouchEvent<HTMLDivElement> | React.PointerEvent<HTMLDivElement>,
  ) => {
    event.stopPropagation();
  }, []);

  const handleMapGestureEnd = useCallback((
    event: React.TouchEvent<HTMLDivElement> | React.PointerEvent<HTMLDivElement>,
  ) => {
    event.stopPropagation();
    setIsMapGestureActive(false);
  }, []);

  const handleLogout = useCallback(async () => {
    setShowLogoutConfirmModal(true);
  }, []);

  const handleConfirmLogout = useCallback(async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await controller.logout();
      setShowLogoutConfirmModal(false);
      history.push('/');
    } finally {
      setIsLoggingOut(false);
    }
  }, [controller, history, isLoggingOut]);

  const handleToggleProject = useCallback((projectId: string) => {
    setActiveProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      setProjectVisibilityPreference(projectId, next.has(projectId));
      return next;
    });
  }, []);

  const handleShowAll = useCallback(() => {
    // Activate only projects that currently have loaded GeoJSON.
    const nextIds = panelProjects.map((p) => p.id);
    setProjectVisibilityPreferences(
      Object.fromEntries(nextIds.map((projectId) => [projectId, true] as const)),
    );
    setActiveProjectIds(new Set(nextIds));
  }, [panelProjects]);

  const handleHideAll = useCallback(() => {
    const nextIds = panelProjects.map((p) => p.id);
    setProjectVisibilityPreferences(
      Object.fromEntries(nextIds.map((projectId) => [projectId, false] as const)),
    );
    setActiveProjectIds(new Set());
  }, [panelProjects]);

  const handleZoomToProject = useCallback((projectId: string) => {
    setProjectVisibilityPreference(projectId, true);

    // Activate the project
    setActiveProjectIds((prev) => {
      if (prev.has(projectId)) return prev;
      const next = new Set(prev);
      next.add(projectId);
      return next;
    });

    // Zoom to this project's bounds — read geoJsonData from the latest state
    // via a functional update trick: we schedule the zoom after React processes
    // the activation above.
    setTimeout(() => {
      // Access the ref-stable map and read geoJsonData at call time
      const map = mapRef.current;
      if (!map) return;

      // Get the source data directly from the map if available
      setGeoJsonData((current) => {
        const fc = current[projectId];
        if (fc) {
          const bounds = computeBounds(current, new Set([projectId]));
          if (bounds) {
            map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 800 });
          }
        }
        return current; // no change
      });
    }, 0);
  }, []);

  const handleMapLoad = useCallback(() => {
    lockMapOrientation(mapRef.current);
  }, []);

  // ---- Render ---------------------------------------------------------------

  if (!controller.isAuthenticated()) return null;

  return (
    <IonPage>
      <IonContent fullscreen className="ion-no-padding" scrollY={false}>
        <IonRefresher
          className="dashboard-refresher"
          disabled={isMapGestureActive}
          slot="fixed"
          onIonRefresh={handleRefresh}
          pullFactor={0.5}
          pullMin={60}
          pullMax={200}
        >
          <IonRefresherContent
            pullingIcon="arrow-down-outline"
            pullingText="Pull down to refresh"
            refreshingSpinner="crescent"
            refreshingText="Syncing projects…"
          />
        </IonRefresher>

        <div className="relative w-full h-full dashboard-map-container" style={{ height: '100dvh' }}>
          <div
            className="w-full h-full dashboard-map-touch-surface"
            onTouchStart={handleMapGestureStart}
            onTouchMove={handleMapGestureMove}
            onTouchEnd={handleMapGestureEnd}
            onTouchCancel={handleMapGestureEnd}
            onPointerDown={handleMapGestureStart}
            onPointerMove={handleMapGestureMove}
            onPointerUp={handleMapGestureEnd}
            onPointerCancel={handleMapGestureEnd}
          >
            {/* ---- Map ---- */}
            {mapStyle && (
              <Map
                ref={mapRef}
                initialViewState={{
                  longitude: MAP.DEFAULT_CENTER[0],
                  latitude: MAP.DEFAULT_CENTER[1],
                  zoom: MAP.DEFAULT_ZOOM,
                  ...MAP.NORTH_UP_ORIENTATION,
                }}
                maxZoom={MAP.MAX_ZOOM}
                {...MAP.ROTATION_LOCK_INTERACTIONS}
                style={{ width: '100%', height: '100%' }}
                mapStyle={mapStyle as maplibregl.StyleSpecification}
                attributionControl={{ compact: true }}
                onLoad={handleMapLoad}
              >
                {/* GeoJSON layers for each active project */}
                {sortedProjects.map((project) => {
                  if (!activeProjectIds.has(project.id) || !geoJsonData[project.id]) {
                    return null;
                  }
                  const color = getProjectColor(project.id, projectColorsById);
                  const sourceId = `project-${project.id}`;

                  return (
                    <Source
                      key={project.id}
                      id={sourceId}
                      type="geojson"
                      data={geoJsonData[project.id]}
                    >
                      {/* Polygon fills */}
                      <Layer
                        id={`${sourceId}-fill`}
                        type="fill"
                        filter={[
                          'match',
                          ['geometry-type'],
                          ['Polygon', 'MultiPolygon'],
                          true,
                          false,
                        ]}
                        paint={{
                          'fill-color': color,
                          'fill-opacity': 0.25,
                        }}
                      />

                      {/* Lines + polygon outlines */}
                      <Layer
                        id={`${sourceId}-line`}
                        type="line"
                        filter={[
                          'match',
                          ['geometry-type'],
                          ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'],
                          true,
                          false,
                        ]}
                        paint={{
                          'line-color': color,
                          'line-width': 2.5,
                        }}
                      />

                      {/* Point circles */}
                      <Layer
                        id={`${sourceId}-circle`}
                        type="circle"
                        filter={[
                          'match',
                          ['geometry-type'],
                          ['Point', 'MultiPoint'],
                          true,
                          false,
                        ]}
                        paint={{
                          'circle-color': color,
                          'circle-radius': 6,
                          'circle-stroke-width': 1.5,
                          'circle-stroke-color': '#ffffff',
                        }}
                      />
                    </Source>
                  );
                })}
              </Map>
            )}
          </div>

          {/* ---- Floating header ---- */}
          <div
            className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between
                        px-3 py-2 bg-slate-900/70 backdrop-blur-sm border-b border-slate-700/30"
            style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}
          >
            {/* Menu toggle */}
            <button
              onClick={() => setIsPanelOpen(true)}
              className="w-10 h-10 flex items-center justify-center rounded-xl
                         bg-slate-800/60 text-slate-200 hover:bg-slate-700/60 transition-colors"
              aria-label="Open project panel"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            {/* Sync status */}
            <div className="flex items-center gap-2">
              {syncStatus === 'syncing' && (
                <span className="flex items-center gap-1.5 text-xs text-slate-300">
                  <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                  Syncing…
                </span>
              )}
              {tilePrefetchSummary && (
                <span className="text-xs text-emerald-300">{tilePrefetchSummary}</span>
              )}
              {syncStatus === 'done' && panelProjects.length > 0 && (
                <span className="text-xs text-slate-400">
                  {panelProjects.length} project{panelProjects.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* Logout */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleLogout}
                className="px-3 py-2 text-xs font-medium text-slate-300 hover:text-white
                           rounded-xl bg-slate-800/60 hover:bg-slate-700/60 transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>

          {/* ---- Project panel ---- */}
          <ProjectPanel
            projects={panelProjects}
            activeProjectIds={panelActiveProjectIds}
            geoJsonData={geoJsonData}
            projectColorsById={projectColorsById}
            tilePrefetchByProject={tilePrefetchByProject}
            onToggleProject={handleToggleProject}
            onZoomToProject={handleZoomToProject}
            onShowAll={handleShowAll}
            onHideAll={handleHideAll}
            onClose={() => setIsPanelOpen(false)}
            isOpen={isPanelOpen}
          />

          <IonModal
            isOpen={showLogoutConfirmModal}
            onDidDismiss={() => setShowLogoutConfirmModal(false)}
            canDismiss={!isLoggingOut}
            backdropDismiss={!isLoggingOut}
          >
            <IonContent className="ion-padding">
              <div className="flex flex-col h-full justify-center max-w-sm mx-auto text-center">
                <div className="mb-6">
                  <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-red-500/20 text-red-300 mb-4">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-7.938 4h15.876c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L2.33 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                  </span>
                  <h2 className="text-xl font-semibold text-slate-100 mb-2">Clear local data and sign out?</h2>
                  <p className="text-slate-300 text-sm mb-2">
                    All local data will be cleared immediately from this device.
                  </p>
                  <p className="text-slate-400 text-sm">
                    This includes cached maps, GeoJSON, projects, and offline credentials. You will not be able to reconnect without network access.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <button
                    type="button"
                    disabled={isLoggingOut}
                    onClick={() => setShowLogoutConfirmModal(false)}
                    className="px-4 py-3 rounded-xl bg-slate-800/70 text-slate-200 hover:bg-slate-700/70 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isLoggingOut}
                    onClick={handleConfirmLogout}
                    className="px-4 py-3 rounded-xl bg-red-600 text-white hover:bg-red-500 disabled:opacity-50 transition-colors"
                  >
                    {isLoggingOut ? 'Clearing data…' : 'Wipe local data & Sign Out'}
                  </button>
                </div>
              </div>
            </IonContent>
          </IonModal>

          {/* ---- Loading state when style not yet loaded ---- */}
          {!mapStyle && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-slate-400">Loading map…</span>
              </div>
            </div>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Dashboard;
