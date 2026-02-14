/**
 * Dashboard -- full-screen map with per-project GeoJSON layers.
 *
 * Replaces the old card-based dashboard with a maplibre-gl map.
 * Each project's cached GeoJSON is rendered as a colored layer that
 * can be toggled on/off via the ProjectPanel.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { IonPage, IonContent, IonRefresher, IonRefresherContent } from '@ionic/react';
import Map, { Layer, Source, NavigationControl } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import type { LngLatBoundsLike } from 'maplibre-gl';

import { useSpeleoDB } from '../context/SpeleoDBProvider';
import { COLOR_PALETTE, MAP } from '../constants';
import { registerTileCacheProtocol, getCachedStyle } from '../services/TileCacheService';
import ProjectPanel from '../components/ProjectPanel';
import type { Project } from '../types/project';

// ==================== GeoJSON type alias ====================

type GeoJsonRecord = Record<string, GeoJSON.FeatureCollection>;

// ==================== Helpers ====================

/** Sort projects by name for stable color assignment. */
function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => a.name.localeCompare(b.name));
}

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

// ==================== Register tile caching protocol once ====================

registerTileCacheProtocol();

// ==================== Component ====================

const Dashboard: React.FC = () => {
  const history = useHistory();
  const { controller, projects, syncStatus, tilePrefetchJobs } = useSpeleoDB();
  const didSyncRef = useRef(false);
  const didFitRef = useRef(false);
  const mapRef = useRef<MapRef>(null);

  // Panel state
  const [isPanelOpen, setIsPanelOpen] = useState(false);

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

  const sortedProjects = useMemo(() => sortProjects(projects), [projects]);
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
    return `${pct}% offline tiles`;
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

      // On first meaningful load, activate all projects that have data
      setActiveProjectIds((prev) => {
        if (prev.size === 0) return new Set(Object.keys(newData));
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
    await controller.syncProjects();
    setLoadTrigger((n) => n + 1);
    event.detail.complete();
  }, [controller]);

  const handleLogout = useCallback(() => {
    controller.logout();
    history.push('/');
  }, [controller, history]);

  const handleToggleProject = useCallback((projectId: string) => {
    setActiveProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, []);

  const handleShowAll = useCallback(() => {
    // Activate only projects that currently have loaded GeoJSON.
    setActiveProjectIds(new Set(panelProjects.map((p) => p.id)));
  }, [panelProjects]);

  const handleHideAll = useCallback(() => {
    setActiveProjectIds(new Set());
  }, []);

  const handleZoomToProject = useCallback((projectId: string) => {
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

  // ---- Render ---------------------------------------------------------------

  if (!controller.isAuthenticated()) return null;

  return (
    <IonPage>
      <IonContent fullscreen className="ion-no-padding" scrollY={false}>
        <IonRefresher
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

        <div className="relative w-full h-full" style={{ height: '100dvh' }}>
          {/* ---- Map ---- */}
          {mapStyle && (
            <Map
              ref={mapRef}
              initialViewState={{
                longitude: MAP.DEFAULT_CENTER[0],
                latitude: MAP.DEFAULT_CENTER[1],
                zoom: MAP.DEFAULT_ZOOM,
              }}
              maxZoom={MAP.MAX_ZOOM}
              style={{ width: '100%', height: '100%' }}
              mapStyle={mapStyle as maplibregl.StyleSpecification}
              attributionControl={{ compact: true }}
            >
              <NavigationControl position="bottom-right" showCompass={true} />

              {/* GeoJSON layers for each active project */}
              {sortedProjects.map((project, idx) => {
                if (!activeProjectIds.has(project.id) || !geoJsonData[project.id]) {
                  return null;
                }
                const color = COLOR_PALETTE[idx % COLOR_PALETTE.length];
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
            tilePrefetchByProject={tilePrefetchByProject}
            onToggleProject={handleToggleProject}
            onZoomToProject={handleZoomToProject}
            onShowAll={handleShowAll}
            onHideAll={handleHideAll}
            onClose={() => setIsPanelOpen(false)}
            isOpen={isPanelOpen}
          />

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
