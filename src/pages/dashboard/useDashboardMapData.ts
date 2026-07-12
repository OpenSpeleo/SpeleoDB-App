import { useEffect, useMemo, useState } from 'react';
import { MAP_OVERLAYS } from '../../constants';
import type {
  MapOverlayGeoJsonRecord,
  MapOverlayId,
} from '../../types/mapOverlay';
import type { Project } from '../../types/project';
import type { ProjectGeoJSONMapData } from '../../types/projectGeoJSON';
import { attachDepthToFeatureCollection, DEPTH_PROPERTY_KEY } from '../../utils/depthColoring';
import { buildLandmarkCollectionGroups } from '../../utils/landmarkCollections';
import { ensureLandmarkPropertyIds } from '../../utils/landmarkMutations';
import { normalizeGeoJSON } from '../../utils/normalizeGeoJSON';
import { createProjectColorState } from '../../utils/projectColors';
import { logPerformanceTiming } from '../../utils/performanceTiming';
import { yieldToMainThread } from '../../utils/yieldToMainThread';
import {
  filterOverlayByProjectVisibility,
  normalizeOverlayGeoJSON,
  type ProjectBoundsRecord,
} from './dashboardMapUtils';

type GeoJsonRecord = Record<string, GeoJSON.FeatureCollection>;
type ProjectMapDataRecord = Record<string, ProjectGeoJSONMapData>;
type StaleCheck = () => boolean;
type WarningReporter = (message: string, error: unknown) => void;
type MainThreadYield = () => Promise<void>;
type AfterPaint = () => Promise<void>;
type BatchPublisher<T> = (batch: ReadonlyMap<string, T>) => void;

interface ProjectMapLoadState {
  projects: readonly Project[];
  revision: number;
  data: ProjectMapDataRecord;
}

interface OverlayMapLoadState {
  mapRevision: number;
  landmarksRevision: number;
  data: MapOverlayGeoJsonRecord;
}

export interface DashboardMapDataSource {
  getProjectMapData: (projectId: string) => Promise<ProjectGeoJSONMapData | null>;
  getOverlayGeoJSON: (overlayId: MapOverlayId) => Promise<unknown | null>;
}

export interface DashboardMapDataOptions {
  source: DashboardMapDataSource;
  projects: readonly Project[];
  mapDataRevision: number;
  landmarksRevision: number;
  warn?: WarningReporter;
  yieldWork?: MainThreadYield;
  afterPaint?: AfterPaint;
}

const defaultWarn: WarningReporter = (message, error) => console.warn(message, error);
const defaultAfterPaint: AfterPaint = () => new Promise((resolve) => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => resolve());
    return;
  }
  setTimeout(resolve, 0);
});
const depthEnrichedCollections = new WeakMap<
GeoJSON.FeatureCollection,
GeoJSON.FeatureCollection
>();

function attachProjectDepth(
  featureCollection: GeoJSON.FeatureCollection,
): GeoJSON.FeatureCollection {
  const cached = depthEnrichedCollections.get(featureCollection);
  if (cached) return cached;
  const enriched = attachDepthToFeatureCollection(featureCollection, DEPTH_PROPERTY_KEY);
  depthEnrichedCollections.set(featureCollection, enriched);
  return enriched;
}

function normalizeProjectMapData(
  project: Project,
  mapData: ProjectGeoJSONMapData | null,
): ProjectGeoJSONMapData | null {
  const featureCollection = normalizeGeoJSON(mapData?.featureCollection);
  if (!featureCollection || featureCollection.features.length === 0) return null;
  if (mapData?.commitId !== project.latest_commit.id) return null;
  return {
    commitId: mapData.commitId,
    featureCollection: attachProjectDepth(featureCollection),
    bounds: mapData.bounds,
  };
}

export function createRenderingBatcher<T>(
  isStale: StaleCheck,
  publish: BatchPublisher<T>,
  yieldWork: MainThreadYield,
): (key: string, value: T) => Promise<void> {
  const pending = new Map<string, T>();
  let scheduled: Promise<void> | null = null;

  const schedule = (): Promise<void> => {
    if (scheduled) return scheduled;
    scheduled = (async () => {
      while (pending.size > 0) {
        await yieldWork();
        if (isStale()) {
          pending.clear();
          return;
        }
        const batch = new Map(pending);
        pending.clear();
        publish(batch);
      }
    })().finally(() => {
      scheduled = null;
    });
    return scheduled;
  };

  return (key, value) => {
    if (isStale()) return Promise.resolve();
    pending.set(key, value);
    return schedule();
  };
}

async function loadProjectMapData(
  source: DashboardMapDataSource,
  projects: readonly Project[],
  isStale: StaleCheck,
  warn: WarningReporter,
  publish: BatchPublisher<ProjectGeoJSONMapData>,
  yieldWork: MainThreadYield,
  runId: number,
  afterPaint: AfterPaint,
): Promise<void> {
  const totalStartedAt = performance.now();
  let cacheReadWorkMs = 0;
  let normalizationWorkMs = 0;
  let cursor = 0;
  const queuePublication = createRenderingBatcher(isStale, publish, yieldWork);
  const worker = async (): Promise<void> => {
    while (cursor < projects.length) {
      const index = cursor;
      cursor += 1;
      const project = projects[index];
      try {
        const cacheReadStartedAt = performance.now();
        const mapData = await source.getProjectMapData(project.id);
        cacheReadWorkMs += Math.max(0, performance.now() - cacheReadStartedAt);
        if (isStale()) return;
        await yieldWork();
        if (isStale()) return;
        const normalizationStartedAt = performance.now();
        const normalized = normalizeProjectMapData(project, mapData);
        normalizationWorkMs += Math.max(0, performance.now() - normalizationStartedAt);
        if (normalized) await queuePublication(project.id, normalized);
        if (isStale()) return;
      } catch (error) {
        if (isStale()) return;
        warn('Failed to load project GeoJSON:', error);
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(4, projects.length) },
    () => worker(),
  ));
  if (isStale()) return;
  await afterPaint();
  if (isStale()) return;
  const status = 'applied';
  logPerformanceTiming('dashboard-map', {
    runId,
    phase: 'project_cache_read_work',
    durationMs: Math.round(cacheReadWorkMs * 10) / 10,
    status,
  });
  logPerformanceTiming('dashboard-map', {
    runId,
    phase: 'project_normalization_work',
    durationMs: Math.round(normalizationWorkMs * 10) / 10,
    status,
  });
  logPerformanceTiming('dashboard-map', {
    runId,
    phase: 'project_total_to_paint',
    durationMs: Math.round(Math.max(0, performance.now() - totalStartedAt) * 10) / 10,
    status,
  });
}

function normalizeOverlay(
  overlayId: MapOverlayId,
  raw: unknown,
): GeoJSON.FeatureCollection | null {
  const featureCollection = normalizeGeoJSON(raw);
  if (!featureCollection || featureCollection.features.length === 0) return null;
  const normalized = normalizeOverlayGeoJSON(overlayId, featureCollection);
  return overlayId === 'landmarks'
    ? ensureLandmarkPropertyIds(normalized)!
    : normalized;
}

async function loadOverlayMapData(
  source: DashboardMapDataSource,
  isStale: StaleCheck,
  warn: WarningReporter,
  publish: BatchPublisher<GeoJSON.FeatureCollection>,
  yieldWork: MainThreadYield,
): Promise<void> {
  const queuePublication = createRenderingBatcher(isStale, publish, yieldWork);
  await Promise.all(MAP_OVERLAYS.map(async (overlay) => {
    try {
      const raw = await source.getOverlayGeoJSON(overlay.id);
      if (isStale()) return;
      await yieldWork();
      if (isStale()) return;
      const normalized = normalizeOverlay(overlay.id, raw);
      if (normalized) await queuePublication(overlay.id, normalized);
      if (isStale()) return;
    } catch (error) {
      if (isStale()) return;
      warn('Failed to load a cached overlay:', error);
    }
  }));
}

function useProjectMapData(
  source: DashboardMapDataSource,
  projects: readonly Project[],
  mapDataRevision: number,
  warn: WarningReporter,
  yieldWork: MainThreadYield,
  afterPaint: AfterPaint,
) {
  const [loadState, setLoadState] = useState<ProjectMapLoadState>({
    projects,
    revision: mapDataRevision,
    data: {},
  });
  useEffect(() => {
    let stale = false;
    void loadProjectMapData(
      source,
      projects,
      () => stale,
      warn,
      (batch) => {
        if (stale) return;
        setLoadState((current) => {
          const currentData = current.projects === projects && current.revision === mapDataRevision
            ? current.data
            : {};
          const nextData = { ...currentData };
          for (const [projectId, data] of batch) nextData[projectId] = data;
          return {
            projects,
            revision: mapDataRevision,
            data: nextData,
          };
        });
      },
      yieldWork,
      mapDataRevision,
      afterPaint,
    );
    return () => { stale = true; };
  }, [afterPaint, mapDataRevision, projects, source, warn, yieldWork]);
  return loadState.projects === projects && loadState.revision === mapDataRevision
    ? loadState.data
    : {};
}

function useOverlayMapData(
  source: DashboardMapDataSource,
  mapDataRevision: number,
  landmarksRevision: number,
  warn: WarningReporter,
  yieldWork: MainThreadYield,
) {
  const [loadState, setLoadState] = useState<OverlayMapLoadState>({
    mapRevision: mapDataRevision,
    landmarksRevision,
    data: {},
  });
  useEffect(() => {
    let stale = false;
    void loadOverlayMapData(
      source,
      () => stale,
      warn,
      (batch) => {
        if (stale) return;
        setLoadState((current) => {
          const currentData = current.mapRevision === mapDataRevision
            && current.landmarksRevision === landmarksRevision
            ? current.data
            : {};
          const nextData = { ...currentData };
          for (const [overlayId, data] of batch) {
            nextData[overlayId as MapOverlayId] = data;
          }
          return {
            mapRevision: mapDataRevision,
            landmarksRevision,
            data: nextData,
          };
        });
      },
      yieldWork,
    );
    return () => { stale = true; };
  }, [landmarksRevision, mapDataRevision, source, warn, yieldWork]);
  return loadState.mapRevision === mapDataRevision
    && loadState.landmarksRevision === landmarksRevision
    ? loadState.data
    : {};
}

export function useDashboardMapData({
  source,
  projects,
  mapDataRevision,
  landmarksRevision,
  warn = defaultWarn,
  yieldWork = yieldToMainThread,
  afterPaint = defaultAfterPaint,
}: DashboardMapDataOptions) {
  const { sortedProjects, projectColorsById } = useMemo(
    () => createProjectColorState([...projects]),
    [projects],
  );
  const geoJsonProjects = useMemo(
    () => sortedProjects.filter((project) => (
      !project.exclude_geojson && Boolean(project.geojson_file)
    )),
    [sortedProjects],
  );
  const projectMapData = useProjectMapData(
    source,
    geoJsonProjects,
    mapDataRevision,
    warn,
    yieldWork,
    afterPaint,
  );
  const currentProjectMapData = useMemo<ProjectMapDataRecord>(() => {
    const next: ProjectMapDataRecord = {};
    for (const project of geoJsonProjects) {
      const loaded = projectMapData[project.id];
      if (loaded?.commitId === project.latest_commit.id) next[project.id] = loaded;
    }
    return next;
  }, [geoJsonProjects, projectMapData]);
  const geoJsonData = useMemo<GeoJsonRecord>(() => Object.fromEntries(
    Object.entries(currentProjectMapData).map(([id, data]) => [id, data.featureCollection]),
  ), [currentProjectMapData]);
  const projectBounds = useMemo<ProjectBoundsRecord>(() => Object.fromEntries(
    Object.entries(currentProjectMapData).map(([id, data]) => [id, data.bounds]),
  ), [currentProjectMapData]);
  const overlayGeoJsonData = useOverlayMapData(
    source,
    mapDataRevision,
    landmarksRevision,
    warn,
    yieldWork,
  );
  const landmarkCollectionGroups = useMemo(
    () => buildLandmarkCollectionGroups(overlayGeoJsonData.landmarks ?? null),
    [overlayGeoJsonData],
  );
  return {
    sortedProjects,
    projectColorsById,
    geoJsonProjects,
    currentProjectMapData,
    geoJsonData,
    projectBounds,
    overlayGeoJsonData,
    landmarkCollectionGroups,
  };
}

export function useVisibleDashboardOverlays(
  overlayGeoJsonData: MapOverlayGeoJsonRecord,
  effectiveActiveProjectIds: ReadonlySet<string>,
) {
  return useMemo(() => {
    const next: MapOverlayGeoJsonRecord = {};
    const activeProjectIds = new Set(effectiveActiveProjectIds);
    for (const overlay of MAP_OVERLAYS) {
      const featureCollection = overlayGeoJsonData[overlay.id];
      if (!featureCollection || featureCollection.features.length === 0) continue;
      const filtered = filterOverlayByProjectVisibility(
        overlay.id,
        featureCollection,
        activeProjectIds,
      );
      if (filtered.features.length > 0) next[overlay.id] = filtered;
    }
    return next;
  }, [effectiveActiveProjectIds, overlayGeoJsonData]);
}
