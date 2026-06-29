import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import type { MapRef } from 'react-map-gl/maplibre';
import {
  getCountryCollapsedPreferences,
  getCountryVisibilityPreferences,
  getProjectVisibilityPreferences,
  setCountryCollapsedPreference,
  setCountryVisibilityPreference,
  setCountryVisibilityPreferences,
  setProjectVisibilityPreference,
  setProjectVisibilityPreferences,
} from '../../services/PreferencesService';
import type { Project } from '../../types/project';
import type { ProjectBoundsRecord } from './dashboardMapUtils';
import { computeBounds } from './dashboardMapUtils';

type VisibilityRecord = Record<string, boolean>;
type PreferenceReader = () => VisibilityRecord;
type PreferenceWriter = (id: string, value: boolean) => void;
type PreferenceBatchWriter = (updates: VisibilityRecord) => void;
type Haptic = () => void;
type Scheduler = (callback: () => void) => void;
type ActiveProjectUpdater = (update: SetStateAction<Set<string>>) => Set<string>;

export interface DashboardProjectVisibilityOptions {
  projects: readonly Project[];
  eligibleProjects: readonly Project[];
  geoJsonData: Readonly<Record<string, GeoJSON.FeatureCollection>>;
  projectBounds: ProjectBoundsRecord;
  mapRef: RefObject<MapRef | null>;
  onClosePanel: () => void;
  initialCountryVisibility?: VisibilityRecord;
  initialCountryCollapsed?: VisibilityRecord;
  readProjectVisibility?: PreferenceReader;
  writeProjectVisibility?: PreferenceWriter;
  writeProjectVisibilityBatch?: PreferenceBatchWriter;
  writeCountryVisibility?: PreferenceWriter;
  writeCountryVisibilityBatch?: PreferenceBatchWriter;
  writeCountryCollapsed?: PreferenceWriter;
  haptic?: Haptic;
  schedule?: Scheduler;
}

export interface DashboardProjectVisibilityState {
  panelProjects: Project[];
  panelActiveProjectIds: Set<string>;
  effectiveActiveProjectIds: Set<string>;
  countryVisibility: VisibilityRecord;
  countryCollapsed: VisibilityRecord;
  toggleProject: (projectId: string) => void;
  showAll: () => void;
  hideAll: () => void;
  toggleCountry: (country: string, visible: boolean) => void;
  toggleCountryCollapsed: (country: string, collapsed: boolean) => void;
  zoomToProject: (projectId: string) => void;
}

const defaultHaptic: Haptic = () => {
  void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
};
const defaultSchedule: Scheduler = (callback) => setTimeout(callback, 0);

function useProjectVisibilityState(
  eligibleProjects: readonly Project[],
  readProjectVisibility: PreferenceReader,
) {
  const [activeProjectIds, setActiveProjectIds] = useState<Set<string>>(new Set());
  const activeProjectIdsRef = useRef(activeProjectIds);
  const knownProjectIdsRef = useRef<Set<string>>(new Set());
  const updateActiveProjectIds = useCallback<ActiveProjectUpdater>((update) => {
    const next = typeof update === 'function' ? update(activeProjectIdsRef.current) : update;
    activeProjectIdsRef.current = next;
    setActiveProjectIds(next);
    return next;
  }, []);

  useEffect(() => {
    const currentIds = new Set(eligibleProjects.map((project) => project.id));
    const preferences = readProjectVisibility();
    updateActiveProjectIds((previous) => {
      const next = new Set([...previous].filter((id) => currentIds.has(id)));
      for (const project of eligibleProjects) {
        if (!knownProjectIdsRef.current.has(project.id) && preferences[project.id] !== false) {
          next.add(project.id);
        }
      }
      return next;
    });
    knownProjectIdsRef.current = currentIds;
  }, [eligibleProjects, readProjectVisibility, updateActiveProjectIds]);

  return { activeProjectIds, updateActiveProjectIds };
}

function useProjectVisibilityDerivations(
  projects: readonly Project[],
  geoJsonData: Readonly<Record<string, GeoJSON.FeatureCollection>>,
  activeProjectIds: ReadonlySet<string>,
  countryVisibility: Readonly<VisibilityRecord>,
) {
  const panelProjects = useMemo(
    () => projects.filter((project) => Boolean(geoJsonData[project.id])),
    [geoJsonData, projects],
  );
  const panelActiveProjectIds = useMemo(
    () => new Set([...activeProjectIds].filter((id) => Boolean(geoJsonData[id]))),
    [activeProjectIds, geoJsonData],
  );
  const effectiveActiveProjectIds = useMemo(() => {
    const next = new Set<string>();
    for (const project of projects) {
      if (!activeProjectIds.has(project.id) || !geoJsonData[project.id]) continue;
      if (countryVisibility[project.country || 'Unknown'] === false) continue;
      next.add(project.id);
    }
    return next;
  }, [activeProjectIds, countryVisibility, geoJsonData, projects]);
  return { panelProjects, panelActiveProjectIds, effectiveActiveProjectIds };
}

interface ProjectActionOptions {
  panelProjects: readonly Project[];
  updateActiveProjectIds: ActiveProjectUpdater;
  setCountryVisibility: Dispatch<SetStateAction<VisibilityRecord>>;
  writeProjectVisibility: PreferenceWriter;
  writeProjectVisibilityBatch: PreferenceBatchWriter;
  writeCountryVisibilityBatch: PreferenceBatchWriter;
  haptic: Haptic;
}

function useProjectToggleActions(options: ProjectActionOptions) {
  const {
    panelProjects,
    updateActiveProjectIds,
    setCountryVisibility,
    writeProjectVisibility,
    writeProjectVisibilityBatch,
    writeCountryVisibilityBatch,
    haptic,
  } = options;
  const toggleProject = useCallback((projectId: string) => {
    haptic();
    const next = updateActiveProjectIds((previous) => {
      const next = new Set(previous);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
    writeProjectVisibility(projectId, next.has(projectId));
  }, [haptic, updateActiveProjectIds, writeProjectVisibility]);

  const showAll = useCallback(() => {
    const ids = panelProjects.map((project) => project.id);
    writeProjectVisibilityBatch(Object.fromEntries(ids.map((id) => [id, true])));
    updateActiveProjectIds(new Set(ids));
    const countries = [...new Set(panelProjects.map((project) => project.country || 'Unknown'))];
    if (countries.length === 0) return;
    const updates = Object.fromEntries(countries.map((country) => [country, true]));
    writeCountryVisibilityBatch(updates);
    setCountryVisibility((previous) => ({ ...previous, ...updates }));
  }, [panelProjects, setCountryVisibility, updateActiveProjectIds,
    writeCountryVisibilityBatch, writeProjectVisibilityBatch]);

  const hideAll = useCallback(() => {
    const ids = panelProjects.map((project) => project.id);
    writeProjectVisibilityBatch(Object.fromEntries(ids.map((id) => [id, false])));
    updateActiveProjectIds(new Set());
  }, [panelProjects, updateActiveProjectIds, writeProjectVisibilityBatch]);

  return { toggleProject, showAll, hideAll };
}

interface CountryActionOptions {
  setCountryVisibility: Dispatch<SetStateAction<VisibilityRecord>>;
  setCountryCollapsed: Dispatch<SetStateAction<VisibilityRecord>>;
  writeCountryVisibility: PreferenceWriter;
  writeCountryCollapsed: PreferenceWriter;
  haptic: Haptic;
}

function useCountryActions(options: CountryActionOptions) {
  const {
    setCountryVisibility,
    setCountryCollapsed,
    writeCountryVisibility,
    writeCountryCollapsed,
    haptic,
  } = options;
  const toggleCountry = useCallback((country: string, visible: boolean) => {
    haptic();
    setCountryVisibility((previous) => ({ ...previous, [country]: visible }));
    writeCountryVisibility(country, visible);
  }, [haptic, setCountryVisibility, writeCountryVisibility]);
  const toggleCountryCollapsed = useCallback((country: string, collapsed: boolean) => {
    setCountryCollapsed((previous) => ({ ...previous, [country]: collapsed }));
    writeCountryCollapsed(country, collapsed);
  }, [setCountryCollapsed, writeCountryCollapsed]);
  return { toggleCountry, toggleCountryCollapsed };
}

interface ZoomActionOptions {
  projects: readonly Project[];
  projectBounds: ProjectBoundsRecord;
  mapRef: RefObject<MapRef | null>;
  countryVisibility: VisibilityRecord;
  updateActiveProjectIds: ActiveProjectUpdater;
  setCountryVisibility: Dispatch<SetStateAction<VisibilityRecord>>;
  writeProjectVisibility: PreferenceWriter;
  writeCountryVisibility: PreferenceWriter;
  onClosePanel: () => void;
  schedule: Scheduler;
}

function useProjectZoomAction(options: ZoomActionOptions) {
  const {
    projects,
    projectBounds,
    mapRef,
    countryVisibility,
    updateActiveProjectIds,
    setCountryVisibility,
    writeProjectVisibility,
    writeCountryVisibility,
    onClosePanel,
    schedule,
  } = options;
  return useCallback((projectId: string) => {
    updateActiveProjectIds((previous) => {
      if (previous.has(projectId)) return previous;
      const next = new Set(previous);
      next.add(projectId);
      return next;
    });
    writeProjectVisibility(projectId, true);
    const project = projects.find((candidate) => candidate.id === projectId);
    if (project) {
      const country = project.country || 'Unknown';
      if (countryVisibility[country] === false) {
        setCountryVisibility((previous) => ({ ...previous, [country]: true }));
        writeCountryVisibility(country, true);
      }
    }
    onClosePanel();
    schedule(() => {
      const map = mapRef.current;
      if (!map) return;
      const bounds = computeBounds(projectBounds, new Set([projectId]));
      if (bounds) map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 800 });
    });
  }, [countryVisibility, mapRef, onClosePanel, projectBounds, projects, schedule,
    setCountryVisibility, updateActiveProjectIds, writeCountryVisibility,
    writeProjectVisibility]);
}

export function useDashboardProjectVisibility({
  readProjectVisibility = getProjectVisibilityPreferences,
  writeProjectVisibility = setProjectVisibilityPreference,
  writeProjectVisibilityBatch = setProjectVisibilityPreferences,
  writeCountryVisibility = setCountryVisibilityPreference,
  writeCountryVisibilityBatch = setCountryVisibilityPreferences,
  writeCountryCollapsed = setCountryCollapsedPreference,
  haptic = defaultHaptic,
  schedule = defaultSchedule,
  ...options
}: DashboardProjectVisibilityOptions): DashboardProjectVisibilityState {
  const { activeProjectIds, updateActiveProjectIds } = useProjectVisibilityState(
    options.eligibleProjects,
    readProjectVisibility,
  );
  const [countryVisibility, setCountryVisibility] = useState<VisibilityRecord>(
    () => options.initialCountryVisibility ?? getCountryVisibilityPreferences(),
  );
  const [countryCollapsed, setCountryCollapsed] = useState<VisibilityRecord>(
    () => options.initialCountryCollapsed ?? getCountryCollapsedPreferences(),
  );
  const derived = useProjectVisibilityDerivations(
    options.projects,
    options.geoJsonData,
    activeProjectIds,
    countryVisibility,
  );
  const projectActions = useProjectToggleActions({
    panelProjects: derived.panelProjects,
    updateActiveProjectIds,
    setCountryVisibility,
    writeProjectVisibility,
    writeProjectVisibilityBatch,
    writeCountryVisibilityBatch,
    haptic,
  });
  const countryActions = useCountryActions({
    setCountryVisibility,
    setCountryCollapsed,
    writeCountryVisibility,
    writeCountryCollapsed,
    haptic,
  });
  const zoomToProject = useProjectZoomAction({
    ...options,
    countryVisibility,
    updateActiveProjectIds,
    setCountryVisibility,
    writeProjectVisibility,
    writeCountryVisibility,
    schedule,
  });
  return {
    ...derived,
    ...projectActions,
    ...countryActions,
    countryVisibility,
    countryCollapsed,
    zoomToProject,
  };
}
