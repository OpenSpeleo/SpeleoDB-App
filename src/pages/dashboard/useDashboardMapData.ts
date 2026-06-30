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
import {
  filterOverlayByProjectVisibility,
  normalizeOverlayGeoJSON,
  type ProjectBoundsRecord,
} from './dashboardMapUtils';

type GeoJsonRecord = Record<string, GeoJSON.FeatureCollection>;
type ProjectMapDataRecord = Record<string, ProjectGeoJSONMapData>;
type StaleCheck = () => boolean;
type WarningReporter = (message: string, error: unknown) => void;

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
}

const defaultWarn: WarningReporter = (message, error) => console.warn(message, error);

function normalizeProjectMapData(
  project: Project,
  mapData: ProjectGeoJSONMapData | null,
): ProjectGeoJSONMapData | null {
  const featureCollection = normalizeGeoJSON(mapData?.featureCollection);
  if (!featureCollection || featureCollection.features.length === 0) return null;
  if (mapData?.commitId !== project.latest_commit.id) return null;
  return {
    commitId: mapData.commitId,
    featureCollection: attachDepthToFeatureCollection(featureCollection, DEPTH_PROPERTY_KEY),
    bounds: mapData.bounds,
  };
}

async function loadProjectMapData(
  source: DashboardMapDataSource,
  projects: readonly Project[],
  isStale: StaleCheck,
  warn: WarningReporter,
): Promise<ProjectMapDataRecord | null> {
  const next: ProjectMapDataRecord = {};
  for (const project of projects) {
    try {
      const mapData = await source.getProjectMapData(project.id);
      if (isStale()) return null;
      const normalized = normalizeProjectMapData(project, mapData);
      if (normalized) next[project.id] = normalized;
    } catch (error) {
      if (isStale()) return null;
      warn('Failed to load project GeoJSON:', error);
    }
  }
  return next;
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
): Promise<MapOverlayGeoJsonRecord | null> {
  const next: MapOverlayGeoJsonRecord = {};
  for (const overlay of MAP_OVERLAYS) {
    try {
      const raw = await source.getOverlayGeoJSON(overlay.id);
      if (isStale()) return null;
      const normalized = normalizeOverlay(overlay.id, raw);
      if (normalized) next[overlay.id] = normalized;
    } catch (error) {
      if (isStale()) return null;
      warn('Failed to load a cached overlay:', error);
    }
  }
  return next;
}

function useProjectMapData(
  source: DashboardMapDataSource,
  projects: readonly Project[],
  mapDataRevision: number,
  warn: WarningReporter,
) {
  const [projectMapData, setProjectMapData] = useState<ProjectMapDataRecord>({});
  useEffect(() => {
    let stale = false;
    void loadProjectMapData(source, projects, () => stale, warn).then((next) => {
      if (!stale && next) setProjectMapData(next);
    });
    return () => { stale = true; };
  }, [mapDataRevision, projects, source, warn]);
  return projectMapData;
}

function useOverlayMapData(
  source: DashboardMapDataSource,
  mapDataRevision: number,
  landmarksRevision: number,
  warn: WarningReporter,
) {
  const [overlayGeoJsonData, setOverlayGeoJsonData] = useState<MapOverlayGeoJsonRecord>({});
  useEffect(() => {
    let stale = false;
    void loadOverlayMapData(source, () => stale, warn).then((next) => {
      if (!stale && next) setOverlayGeoJsonData(next);
    });
    return () => { stale = true; };
  }, [landmarksRevision, mapDataRevision, source, warn]);
  return overlayGeoJsonData;
}

export function useDashboardMapData({
  source,
  projects,
  mapDataRevision,
  landmarksRevision,
  warn = defaultWarn,
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
