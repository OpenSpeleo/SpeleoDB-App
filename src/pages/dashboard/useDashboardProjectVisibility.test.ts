import type { RefObject } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../types/project';
import type { ProjectBoundsRecord } from './dashboardMapUtils';
import { useDashboardProjectVisibility } from './useDashboardProjectVisibility';

const {
  mockImpact,
  mockReadProjects,
  mockReadCountries,
  mockReadCollapsed,
  mockWriteProject,
  mockWriteProjects,
  mockWriteCountry,
  mockWriteCountries,
  mockWriteCollapsed,
} = vi.hoisted(() => ({
  mockImpact: vi.fn(() => Promise.resolve()),
  mockReadProjects: vi.fn(() => ({} as Record<string, boolean>)),
  mockReadCountries: vi.fn(() => ({} as Record<string, boolean>)),
  mockReadCollapsed: vi.fn(() => ({} as Record<string, boolean>)),
  mockWriteProject: vi.fn(),
  mockWriteProjects: vi.fn(),
  mockWriteCountry: vi.fn(),
  mockWriteCountries: vi.fn(),
  mockWriteCollapsed: vi.fn(),
}));

vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: mockImpact },
  ImpactStyle: { Light: 'LIGHT' },
}));

vi.mock('../../services/PreferencesService', () => ({
  getProjectVisibilityPreferences: mockReadProjects,
  getCountryVisibilityPreferences: mockReadCountries,
  getCountryCollapsedPreferences: mockReadCollapsed,
  setProjectVisibilityPreference: mockWriteProject,
  setProjectVisibilityPreferences: mockWriteProjects,
  setCountryVisibilityPreference: mockWriteCountry,
  setCountryVisibilityPreferences: mockWriteCountries,
  setCountryCollapsedPreference: mockWriteCollapsed,
}));

const EMPTY_GEOJSON: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

function createProject(id: string, country: string): Project {
  return {
    id,
    name: `Project ${id}`,
    description: '',
    country,
    color: '#ffffff',
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
  };
}

const PROJECT_A = createProject('a', 'Canada');
const PROJECT_B = createProject('b', 'Mexico');
const PROJECT_UNKNOWN = createProject('unknown', '');
const PROJECTS = [PROJECT_A, PROJECT_B, PROJECT_UNKNOWN];
const GEOJSON = {
  a: EMPTY_GEOJSON,
  b: EMPTY_GEOJSON,
  unknown: EMPTY_GEOJSON,
};
const BOUNDS: ProjectBoundsRecord = {
  a: { west: -1, east: 1, south: -1, north: 1, crossesDateline: false },
};

function createMapRef() {
  const fitBounds = vi.fn();
  const mapRef = {
    current: { fitBounds } as unknown as MapRef,
  } as RefObject<MapRef | null>;
  return { mapRef, fitBounds };
}

interface RenderOptions {
  projects?: Project[];
  eligibleProjects?: Project[];
  geoJsonData?: Record<string, GeoJSON.FeatureCollection>;
  projectBounds?: ProjectBoundsRecord;
  mapRef?: RefObject<MapRef | null>;
  initialCountryVisibility?: Record<string, boolean>;
  initialCountryCollapsed?: Record<string, boolean>;
  readProjectVisibility?: () => Record<string, boolean>;
  writeProjectVisibility?: (id: string, value: boolean) => void;
  writeProjectVisibilityBatch?: (updates: Record<string, boolean>) => void;
  writeCountryVisibility?: (id: string, value: boolean) => void;
  writeCountryVisibilityBatch?: (updates: Record<string, boolean>) => void;
  writeCountryCollapsed?: (id: string, value: boolean) => void;
  haptic?: () => void;
  schedule?: (callback: () => void) => void;
}

function renderVisibility(options: RenderOptions = {}) {
  const fallbackMap = createMapRef();
  const onClosePanel = vi.fn();
  const hook = renderHook(() => useDashboardProjectVisibility({
    projects: options.projects ?? PROJECTS,
    eligibleProjects: options.eligibleProjects ?? PROJECTS,
    geoJsonData: options.geoJsonData ?? GEOJSON,
    projectBounds: options.projectBounds ?? BOUNDS,
    mapRef: options.mapRef ?? fallbackMap.mapRef,
    onClosePanel,
    initialCountryVisibility: options.initialCountryVisibility,
    initialCountryCollapsed: options.initialCountryCollapsed,
    readProjectVisibility: options.readProjectVisibility,
    writeProjectVisibility: options.writeProjectVisibility,
    writeProjectVisibilityBatch: options.writeProjectVisibilityBatch,
    writeCountryVisibility: options.writeCountryVisibility,
    writeCountryVisibilityBatch: options.writeCountryVisibilityBatch,
    writeCountryCollapsed: options.writeCountryCollapsed,
    haptic: options.haptic,
    schedule: options.schedule,
  }));
  return { ...hook, ...fallbackMap, onClosePanel };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockImpact.mockResolvedValue(undefined);
  mockReadProjects.mockReturnValue({});
  mockReadCountries.mockReturnValue({});
  mockReadCollapsed.mockReturnValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDashboardProjectVisibility preferences and derivations', () => {
  it('restores defaults and separates panel intent from effective country visibility', async () => {
    mockReadProjects.mockReturnValue({ b: false });
    mockReadCountries.mockReturnValue({ Canada: false });
    mockReadCollapsed.mockReturnValue({ Mexico: true });
    const geoJsonData = { a: EMPTY_GEOJSON, b: EMPTY_GEOJSON };
    const { result } = renderVisibility({ geoJsonData });

    await waitFor(() => {
      expect([...result.current.panelActiveProjectIds]).toEqual(['a']);
    });
    expect(result.current.panelProjects).toEqual([PROJECT_A, PROJECT_B]);
    expect([...result.current.effectiveActiveProjectIds]).toEqual([]);
    expect(result.current.countryVisibility).toEqual({ Canada: false });
    expect(result.current.countryCollapsed).toEqual({ Mexico: true });
    expect(mockReadProjects).toHaveBeenCalledOnce();
    expect(mockReadCountries).toHaveBeenCalledOnce();
    expect(mockReadCollapsed).toHaveBeenCalledOnce();
  });

  it('drops unavailable projects without re-enabling a known user-hidden project', async () => {
    const readProjectVisibility = vi.fn(() => ({}));
    const { result, rerender } = renderHook(
      ({ eligibleProjects }) => useDashboardProjectVisibility({
        projects: PROJECTS,
        eligibleProjects,
        geoJsonData: GEOJSON,
        projectBounds: BOUNDS,
        mapRef: createMapRef().mapRef,
        onClosePanel: vi.fn(),
        initialCountryVisibility: {},
        initialCountryCollapsed: {},
        readProjectVisibility,
      }),
      { initialProps: { eligibleProjects: [PROJECT_A] } },
    );
    await waitFor(() => expect([...result.current.panelActiveProjectIds]).toEqual(['a']));

    act(() => result.current.toggleProject('a'));
    rerender({ eligibleProjects: [PROJECT_A] });
    expect([...result.current.panelActiveProjectIds]).toEqual([]);

    rerender({ eligibleProjects: [PROJECT_A, PROJECT_B] });
    await waitFor(() => expect([...result.current.panelActiveProjectIds]).toEqual(['b']));
    rerender({ eligibleProjects: [PROJECT_B] });
    expect([...result.current.panelActiveProjectIds]).toEqual(['b']);
  });
});

describe('useDashboardProjectVisibility actions', () => {
  it('toggles projects and countries through injected collaborators', async () => {
    const haptic = vi.fn();
    const writeProjectVisibility = vi.fn();
    const writeCountryVisibility = vi.fn();
    const writeCountryCollapsed = vi.fn();
    const { result } = renderVisibility({
      initialCountryVisibility: {},
      initialCountryCollapsed: {},
      haptic,
      writeProjectVisibility,
      writeCountryVisibility,
      writeCountryCollapsed,
    });
    await waitFor(() => expect(result.current.panelActiveProjectIds.size).toBe(3));

    act(() => {
      result.current.toggleProject('a');
      result.current.toggleProject('a');
      result.current.toggleCountry('Canada', false);
      result.current.toggleCountryCollapsed('Canada', true);
    });

    expect([...result.current.panelActiveProjectIds]).toEqual(['b', 'unknown', 'a']);
    expect(result.current.countryVisibility.Canada).toBe(false);
    expect(result.current.countryCollapsed.Canada).toBe(true);
    expect(haptic).toHaveBeenCalledTimes(3);
    expect(writeProjectVisibility).toHaveBeenNthCalledWith(1, 'a', false);
    expect(writeProjectVisibility).toHaveBeenNthCalledWith(2, 'a', true);
    expect(writeCountryVisibility).toHaveBeenCalledWith('Canada', false);
    expect(writeCountryCollapsed).toHaveBeenCalledWith('Canada', true);
  });

  it('shows loaded projects and countries, then hides projects without changing gates', async () => {
    const writeProjectVisibilityBatch = vi.fn();
    const writeCountryVisibilityBatch = vi.fn();
    const { result } = renderVisibility({
      initialCountryVisibility: { Canada: false, Unknown: false },
      initialCountryCollapsed: {},
      readProjectVisibility: () => ({ a: false, b: false, unknown: false }),
      writeProjectVisibilityBatch,
      writeCountryVisibilityBatch,
    });
    await waitFor(() => expect(result.current.panelActiveProjectIds.size).toBe(0));

    act(() => result.current.showAll());
    expect([...result.current.panelActiveProjectIds]).toEqual(['a', 'b', 'unknown']);
    expect(result.current.countryVisibility).toEqual({
      Canada: true,
      Unknown: true,
      Mexico: true,
    });
    expect(writeProjectVisibilityBatch).toHaveBeenCalledWith({
      a: true,
      b: true,
      unknown: true,
    });
    expect(writeCountryVisibilityBatch).toHaveBeenCalledWith({
      Canada: true,
      Mexico: true,
      Unknown: true,
    });

    act(() => result.current.hideAll());
    expect(result.current.panelActiveProjectIds.size).toBe(0);
    expect(result.current.countryVisibility).toEqual({
      Canada: true,
      Unknown: true,
      Mexico: true,
    });
    expect(writeProjectVisibilityBatch).toHaveBeenLastCalledWith({
      a: false,
      b: false,
      unknown: false,
    });
  });

  it('handles show and hide all when no project data is loaded', () => {
    const writeProjectVisibilityBatch = vi.fn();
    const writeCountryVisibilityBatch = vi.fn();
    const { result } = renderVisibility({
      geoJsonData: {},
      initialCountryVisibility: {},
      initialCountryCollapsed: {},
      writeProjectVisibilityBatch,
      writeCountryVisibilityBatch,
    });

    act(() => {
      result.current.showAll();
      result.current.hideAll();
    });
    expect(writeProjectVisibilityBatch).toHaveBeenNthCalledWith(1, {});
    expect(writeProjectVisibilityBatch).toHaveBeenNthCalledWith(2, {});
    expect(writeCountryVisibilityBatch).not.toHaveBeenCalled();
  });

  it('uses default preference writers and suppresses unavailable haptic feedback', async () => {
    mockImpact.mockRejectedValueOnce(new Error('haptics unavailable'));
    const { result } = renderVisibility();
    await waitFor(() => expect(result.current.panelActiveProjectIds.size).toBe(3));

    act(() => {
      result.current.toggleProject('a');
      result.current.toggleCountry('Canada', false);
      result.current.toggleCountryCollapsed('Canada', true);
      result.current.showAll();
      result.current.hideAll();
    });
    await act(async () => Promise.resolve());

    expect(mockImpact).toHaveBeenCalledTimes(2);
    expect(mockWriteProject).toHaveBeenCalledWith('a', false);
    expect(mockWriteCountry).toHaveBeenCalledWith('Canada', false);
    expect(mockWriteCollapsed).toHaveBeenCalledWith('Canada', true);
    expect(mockWriteProjects).toHaveBeenCalledTimes(2);
    expect(mockWriteCountries).toHaveBeenCalledOnce();
  });
});

describe('useDashboardProjectVisibility zoom', () => {
  it('reveals the target country, closes the panel, and fits validated bounds', async () => {
    const callbacks: Array<() => void> = [];
    const writeProjectVisibility = vi.fn();
    const writeCountryVisibility = vi.fn();
    const { mapRef, fitBounds } = createMapRef();
    const { result, onClosePanel } = renderVisibility({
      mapRef,
      initialCountryVisibility: { Canada: false },
      initialCountryCollapsed: {},
      writeProjectVisibility,
      writeCountryVisibility,
      schedule: (callback) => callbacks.push(callback),
    });
    await waitFor(() => expect(result.current.panelActiveProjectIds.has('a')).toBe(true));

    act(() => result.current.zoomToProject('a'));
    expect(result.current.countryVisibility.Canada).toBe(true);
    expect(writeProjectVisibility).toHaveBeenCalledWith('a', true);
    expect(writeCountryVisibility).toHaveBeenCalledWith('Canada', true);
    expect(onClosePanel).toHaveBeenCalledOnce();
    act(() => callbacks.shift()?.());
    expect(fitBounds).toHaveBeenCalledWith(
      [[-1.2, -1.2], [1.2, 1.2]],
      { padding: 60, maxZoom: 16, duration: 800 },
    );
  });

  it('handles unknown projects, missing bounds, and an unavailable map', () => {
    const callbacks: Array<() => void> = [];
    const { mapRef, fitBounds } = createMapRef();
    const { result } = renderVisibility({
      mapRef,
      initialCountryVisibility: {},
      initialCountryCollapsed: {},
      schedule: (callback) => callbacks.push(callback),
    });

    act(() => {
      result.current.zoomToProject('missing');
      result.current.zoomToProject('b');
    });
    mapRef.current = null;
    act(() => callbacks.shift()?.());
    mapRef.current = { fitBounds } as unknown as MapRef;
    act(() => callbacks.shift()?.());
    expect(fitBounds).not.toHaveBeenCalled();
  });

  it('uses the default scheduler to zoom to a project with an unknown country', async () => {
    vi.useFakeTimers();
    const { result, fitBounds } = renderVisibility({
      projects: [PROJECT_UNKNOWN],
      eligibleProjects: [PROJECT_UNKNOWN],
      geoJsonData: { unknown: EMPTY_GEOJSON },
      projectBounds: {
        unknown: { west: 0, east: 0, south: 0, north: 0, crossesDateline: false },
      },
      initialCountryVisibility: { Unknown: false },
      initialCountryCollapsed: {},
    });

    act(() => {
      result.current.zoomToProject('unknown');
      vi.runAllTimers();
    });
    expect(mockWriteCountry).toHaveBeenCalledWith('Unknown', true);
    expect(fitBounds).toHaveBeenCalledOnce();
  });
});
