import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MapOverlayGeoJsonRecord, MapOverlayId } from '../../types/mapOverlay';
import type { Project } from '../../types/project';
import type { ProjectGeoJSONMapData } from '../../types/projectGeoJSON';
import {
  createRenderingBatcher,
  useDashboardMapData,
  useVisibleDashboardOverlays,
  type DashboardMapDataSource,
} from './useDashboardMapData';

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const BOUNDS = { west: -1, east: 1, south: -1, north: 1, crossesDateline: false };

function createProject(
  id: string,
  name = id,
  overrides: Partial<Project> = {},
): Project {
  return {
    id,
    name,
    description: '',
    country: 'CA',
    color: '#123456',
    type: 'private',
    visibility: 'private',
    is_active: true,
    created_by: 'owner',
    creation_date: '2026-01-01',
    modified_date: '2026-01-01',
    commit_count: 1,
    active_mutex: null,
    fork_from: null,
    exclude_geojson: false,
    geojson_file: `${id}.geojson`,
    latest_commit: {
      id: `commit-${id}`,
      message: '',
      author_email: '',
      author_name: '',
      authored_date: '',
      dt_since: '',
      parent_ids: [],
      url: '',
      formats: [],
      tree: [],
    },
    ...overrides,
  };
}

function pointFeature(
  id: string,
  properties: Record<string, unknown> = {},
): GeoJSON.Feature {
  return {
    type: 'Feature',
    id,
    properties,
    geometry: { type: 'Point', coordinates: [-73, 45, -5] },
  };
}

function collection(...features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features };
}

function mapData(
  project: Project,
  featureCollection = collection(pointFeature(`feature-${project.id}`)),
  commitId = project.latest_commit.id,
): ProjectGeoJSONMapData {
  return { commitId, featureCollection, bounds: BOUNDS };
}

function createSource(overrides: {
  getProjectMapData?: (projectId: string) => Promise<ProjectGeoJSONMapData | null>;
  getOverlayGeoJSON?: (overlayId: MapOverlayId) => Promise<unknown | null>;
} = {}) {
  return {
    getProjectMapData: vi.fn(overrides.getProjectMapData ?? (async () => null)),
    getOverlayGeoJSON: vi.fn(overrides.getOverlayGeoJSON ?? (async () => null)),
  } satisfies DashboardMapDataSource;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useDashboardMapData', () => {
  it('logs cache, normalization, and next-paint latency without project identity', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const project = createProject('private-project');
    const projects = [project];
    const source = createSource({
      getProjectMapData: async () => mapData(project),
    });
    const yieldWork = async () => {};
    const afterPaint = async () => {};
    const { result } = renderHook(() => useDashboardMapData({
      source,
      projects,
      mapDataRevision: 7,
      landmarksRevision: 0,
      yieldWork,
      afterPaint,
    }));

    await waitFor(() => expect(result.current.geoJsonData[project.id]).toBeDefined());
    await waitFor(() => {
      const records = consoleLog.mock.calls.filter(
        ([label]) => label === '[dashboard-map:timing]',
      );
      expect(records).toHaveLength(3);
    });
    const records = consoleLog.mock.calls
      .filter(([label]) => label === '[dashboard-map:timing]')
      .map(([, record]) => record);

    expect(records.map((record) => record.phase)).toEqual([
      'project_cache_read_work',
      'project_normalization_work',
      'project_total_to_paint',
    ]);
    expect(records.every((record) => record.runId === 7)).toBe(true);
    expect(JSON.stringify(records)).not.toContain(project.id);
    expect(JSON.stringify(records)).not.toContain(project.name);
  });

  it('coalesces 60 ready records into one rendering turn', async () => {
    const renderingTurn = deferred<void>();
    const yieldWork = vi.fn(() => renderingTurn.promise);
    const publish = vi.fn();
    const queue = createRenderingBatcher(
      () => false,
      publish,
      yieldWork,
    );

    const publications = Array.from({ length: 60 }, (_, index) => (
      queue(`project-${index}`, index)
    ));
    expect(yieldWork).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();

    renderingTurn.resolve();
    await Promise.all(publications);

    expect(publish).toHaveBeenCalledOnce();
    expect(publish.mock.calls[0][0]).toBeInstanceOf(Map);
    expect((publish.mock.calls[0][0] as ReadonlyMap<string, number>).size).toBe(60);
  });

  it('loads other overlays while the landmarks cache read is pending', async () => {
    const landmarksRead = deferred<unknown | null>();
    const source = createSource({
      getOverlayGeoJSON: (overlayId) => (
        overlayId === 'landmarks'
          ? landmarksRead.promise
          : Promise.resolve(collection(pointFeature(overlayId)))
      ),
    });
    const projects: Project[] = [];
    const { result } = renderHook(() => useDashboardMapData({
      source,
      projects,
      mapDataRevision: 1,
      landmarksRevision: 1,
    }));

    await waitFor(() => expect(source.getOverlayGeoJSON).toHaveBeenCalledTimes(5));
    await waitFor(() => (
      expect(result.current.overlayGeoJsonData.surfaceStations).toBeDefined()
    ));

    landmarksRead.resolve(null);
  });

  it('reuses depth-enriched project data across revision-only reloads', async () => {
    const project = createProject('project');
    const projects = [project];
    const yieldWork = async () => {};
    const raw = collection(pointFeature('depth-point'));
    const source = createSource({
      getProjectMapData: async () => mapData(project, raw),
    });
    const { result, rerender } = renderHook(
      ({ revision }) => useDashboardMapData({
        source,
        projects,
        mapDataRevision: revision,
        landmarksRevision: 0,
        yieldWork,
      }),
      { initialProps: { revision: 0 } },
    );

    await waitFor(() => expect(result.current.geoJsonData.project).toBeDefined());
    const first = result.current.geoJsonData.project;
    expect(first.features[0].properties).toMatchObject({ _speleoDepth: -5 });

    rerender({ revision: 1 });
    await waitFor(() => expect(source.getProjectMapData).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.geoJsonData.project).toBeDefined());

    expect(result.current.geoJsonData.project).toBe(first);
  });

  it('publishes an available project while a later project cache read is pending', async () => {
    const first = createProject('first');
    const second = createProject('second');
    const secondRead = deferred<ProjectGeoJSONMapData | null>();
    const source = createSource({
      getProjectMapData: (id) => (
        id === first.id ? Promise.resolve(mapData(first)) : secondRead.promise
      ),
    });
    const projects = [first, second];
    const { result } = renderHook(() => useDashboardMapData({
      source,
      projects,
      mapDataRevision: 1,
      landmarksRevision: 1,
    }));

    await waitFor(() => expect(source.getProjectMapData).toHaveBeenCalledWith(second.id));
    await waitFor(() => expect(result.current.geoJsonData.first).toBeDefined());
    const firstVisibleWhileSecondPending = result.current.geoJsonData.first;
    await act(async () => {
      secondRead.resolve(mapData(second));
      await secondRead.promise;
    });

    expect(firstVisibleWhileSecondPending).toBeDefined();
    await waitFor(() => expect(result.current.geoJsonData.second).toBeDefined());
  });

  it('publishes validated cache records before the first completed sync revision', async () => {
    const visible = createProject('b', 'Bravo');
    const source = createSource({
      getProjectMapData: async (id) => id === visible.id ? mapData(visible) : null,
      getOverlayGeoJSON: async (id) => id === 'landmarks'
        ? collection(pointFeature('cached-landmark'))
        : null,
    });
    const projects = [
      visible,
      createProject('a', 'Alpha', { exclude_geojson: true }),
      createProject('c', 'Charlie', { geojson_file: null }),
    ];
    const { result } = renderHook(() => useDashboardMapData({
      source,
      projects,
      mapDataRevision: 0,
      landmarksRevision: 0,
    }));

    expect(result.current.sortedProjects.map((project) => project.id)).toEqual(['a', 'b', 'c']);
    expect(result.current.geoJsonProjects.map((project) => project.id)).toEqual(['b']);
    await waitFor(() => expect(result.current.geoJsonData.b).toBeDefined());
    await waitFor(() => expect(result.current.overlayGeoJsonData.landmarks).toBeDefined());
    expect(result.current.currentProjectMapData.b.commitId).toBe('commit-b');
    expect(result.current.projectBounds).toEqual({ b: BOUNDS });
    expect(result.current.landmarkCollectionGroups).toHaveLength(1);
    expect(source.getProjectMapData).toHaveBeenCalledOnce();
    expect(source.getOverlayGeoJSON).toHaveBeenCalledTimes(5);
  });

  it('publishes only non-empty commit-matched projects and normalized overlays', async () => {
    const valid = createProject('valid', 'Zulu');
    const empty = createProject('empty', 'Echo');
    const stale = createProject('stale', 'Sierra');
    const malformed = createProject('malformed', 'Mike');
    const missing = createProject('missing', 'November');
    const responses: Record<string, ProjectGeoJSONMapData | null> = {
      valid: mapData(valid),
      empty: mapData(empty, EMPTY),
      stale: mapData(stale, collection(pointFeature('stale')), 'old-commit'),
      malformed: { ...mapData(malformed), featureCollection: null as never },
      missing: null,
    };
    const landmark = pointFeature('landmark-1', {
      name: 'Entrance',
      collection: 'survey',
      collection_name: 'Survey',
      collection_color: '#abcdef',
    });
    const source = createSource({
      getProjectMapData: async (id) => responses[id] ?? null,
      getOverlayGeoJSON: async (id) => {
        if (id === 'landmarks') return collection(landmark);
        if (id === 'subsurfaceStations') return EMPTY;
        if (id === 'surfaceStations') return null;
        if (id === 'explorationLeads') return collection(pointFeature('lead-1'));
        return { invalid: true };
      },
    });
    const projects = [valid, empty, stale, malformed, missing];
    const warn = vi.fn();
    const { result } = renderHook(() => useDashboardMapData({
      source,
      projects,
      mapDataRevision: 1,
      landmarksRevision: 1,
      warn,
    }));

    await waitFor(() => expect(source.getOverlayGeoJSON).toHaveBeenCalledTimes(5));
    await waitFor(() => expect(Object.keys(result.current.geoJsonData)).toEqual(['valid']));
    expect(result.current.currentProjectMapData.valid.commitId).toBe('commit-valid');
    expect(result.current.geoJsonData.valid.features[0].properties)
      .toMatchObject({ _speleoDepth: -5 });
    expect(result.current.projectBounds).toEqual({ valid: BOUNDS });
    expect(Object.keys(result.current.overlayGeoJsonData))
      .toEqual(['landmarks', 'explorationLeads']);
    expect(result.current.overlayGeoJsonData.landmarks?.features[0].properties)
      .toMatchObject({ id: 'landmark-1' });
    expect(result.current.landmarkCollectionGroups).toHaveLength(1);
    expect(result.current.landmarkCollectionGroups[0]).toMatchObject({
      id: 'survey',
      count: 1,
    });
  });

  it('reports cache failures, continues loading, and clears data on later revisions', async () => {
    const project = createProject('project');
    const projects = [project];
    const warn = vi.fn();
    let fail = true;
    const source = createSource({
      getProjectMapData: async () => {
        if (fail) throw new Error('project read failed');
        return null;
      },
      getOverlayGeoJSON: async (id) => {
        if (fail && id === 'landmarks') throw new Error('overlay read failed');
        return id === 'surfaceStations' && fail
          ? collection(pointFeature('surface'))
          : null;
      },
    });
    const { result, rerender } = renderHook(
      ({ revision }) => useDashboardMapData({
        source,
        projects,
        mapDataRevision: revision,
        landmarksRevision: revision,
        warn,
      }),
      { initialProps: { revision: 1 } },
    );

    await waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.overlayGeoJsonData.surfaceStations).toBeDefined());
    expect(warn).toHaveBeenCalledWith('Failed to load project GeoJSON:', expect.any(Error));
    expect(warn).toHaveBeenCalledWith('Failed to load a cached overlay:', expect.any(Error));

    fail = false;
    rerender({ revision: 2 });
    await waitFor(() => expect(result.current.overlayGeoJsonData).toEqual({}));
    expect(result.current.geoJsonData).toEqual({});
  });

  it('uses the redacted process console boundary as the default warning reporter', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = createSource({
      getProjectMapData: async () => { throw new Error('failed'); },
    });
    const projects = [createProject('project')];
    renderHook(() => useDashboardMapData({
      source,
      projects,
      mapDataRevision: 1,
      landmarksRevision: 1,
    }));

    await waitFor(() => expect(warning).toHaveBeenCalledWith(
      'Failed to load project GeoJSON:',
      expect.any(Error),
    ));
  });

  it('suppresses stale project failures and overlay completions after unmount', async () => {
    const projectRead = deferred<ProjectGeoJSONMapData | null>();
    const overlayRead = deferred<unknown | null>();
    const warn = vi.fn();
    const projects = [createProject('project')];
    const source = createSource({
      getProjectMapData: () => projectRead.promise,
      getOverlayGeoJSON: () => overlayRead.promise,
    });
    const { unmount } = renderHook(() => useDashboardMapData({
      source,
      projects,
      mapDataRevision: 1,
      landmarksRevision: 1,
      warn,
    }));
    unmount();

    await act(async () => {
      projectRead.reject(new Error('late failure'));
      overlayRead.resolve(collection(pointFeature('late-overlay')));
      await Promise.allSettled([projectRead.promise, overlayRead.promise]);
    });
    expect(warn).not.toHaveBeenCalled();
    expect(source.getProjectMapData).toHaveBeenCalledOnce();
    expect(source.getOverlayGeoJSON).toHaveBeenCalledTimes(5);
  });

  it('suppresses stale project completions and overlay failures after unmount', async () => {
    const projectRead = deferred<ProjectGeoJSONMapData | null>();
    const overlayRead = deferred<unknown | null>();
    const warn = vi.fn();
    const project = createProject('project');
    const projects = [project];
    const source = createSource({
      getProjectMapData: () => projectRead.promise,
      getOverlayGeoJSON: () => overlayRead.promise,
    });
    const { unmount } = renderHook(() => useDashboardMapData({
      source,
      projects,
      mapDataRevision: 1,
      landmarksRevision: 1,
      warn,
    }));
    unmount();

    await act(async () => {
      projectRead.resolve(mapData(project));
      overlayRead.reject(new Error('late overlay failure'));
      await Promise.allSettled([projectRead.promise, overlayRead.promise]);
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('hides old commit data immediately while the replacement read is pending', async () => {
    const original = createProject('project');
    const replacement = createProject('project', 'project', {
      latest_commit: { ...original.latest_commit, id: 'replacement-commit' },
    });
    const replacementRead = deferred<ProjectGeoJSONMapData | null>();
    let revision = 1;
    const warn = vi.fn();
    const originalProjects = [original];
    const replacementProjects = [replacement];
    const source = createSource({
      getProjectMapData: async () => (
        revision === 1 ? mapData(original) : replacementRead.promise
      ),
    });
    const { result, rerender } = renderHook(
      ({ projects }) => useDashboardMapData({
        source,
        projects,
        mapDataRevision: revision,
        landmarksRevision: 1,
        warn,
      }),
      { initialProps: { projects: originalProjects } },
    );
    await waitFor(() => expect(result.current.geoJsonData.project).toBeDefined());

    revision = 2;
    rerender({ projects: replacementProjects });
    expect(result.current.geoJsonData).toEqual({});
    await act(async () => {
      replacementRead.resolve(mapData(replacement));
      await replacementRead.promise;
    });
    await waitFor(() => expect(result.current.geoJsonData.project).toBeDefined());
  });
});

describe('useVisibleDashboardOverlays', () => {
  it('retains global overlays and filters or drops project-linked overlays', () => {
    const overlays: MapOverlayGeoJsonRecord = {
      landmarks: collection(pointFeature('landmark')),
      surfaceStations: EMPTY,
      subsurfaceStations: collection(
        pointFeature('station-a', { project: 'a' }),
        pointFeature('station-b', { project: 'b' }),
      ),
      explorationLeads: collection(pointFeature('lead', { project: 'missing' })),
      cylinderInstalls: collection(pointFeature('cylinder', { project_id: 7 })),
    };
    const { result, rerender } = renderHook(
      ({ active }) => useVisibleDashboardOverlays(overlays, active),
      { initialProps: { active: new Set(['a']) } },
    );

    expect(Object.keys(result.current)).toEqual(['landmarks', 'subsurfaceStations']);
    expect(result.current.subsurfaceStations?.features.map((feature) => feature.id))
      .toEqual(['station-a']);

    rerender({ active: new Set<string>() });
    expect(result.current).toEqual({ landmarks: overlays.landmarks });
  });

  it('returns an empty record when no overlay data exists', () => {
    const { result } = renderHook(() => useVisibleDashboardOverlays({}, new Set()));
    expect(result.current).toEqual({});
  });
});
