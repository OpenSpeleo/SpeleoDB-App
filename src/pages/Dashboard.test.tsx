import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'react-router-dom';
import { createMemoryHistory } from 'history';
import Dashboard from './Dashboard';
import { MAP } from '../constants';
import type { Project } from '../types/project';
import type { GpsTrackListItem, RecordedPoint } from '../types/gpsTrack';
import type { DashboardPanel } from '../types/dashboardPanel';
import { LandmarkMutationError } from '../types/landmark';
import { allowConsoleWarn } from '../test/consoleGuard';
import { normalizeGeoJSON } from '../utils/normalizeGeoJSON';
import { measureProjectGeoJSONBounds } from '../utils/projectGeoJSONBounds';

// jsdom lacks PointerEvent -- polyfill so fireEvent.pointerDown/Up creates
// events with pointerId/pointerType that the pointer-capture handlers rely on.
if (typeof globalThis.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly width: number;
    readonly height: number;
    readonly pressure: number;
    readonly tiltX: number;
    readonly tiltY: number;
    readonly twist: number;
    readonly isPrimary: boolean;

    constructor(type: string, init: PointerEventInit & MouseEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? '';
      this.width = init.width ?? 1;
      this.height = init.height ?? 1;
      this.pressure = init.pressure ?? 0;
      this.tiltX = init.tiltX ?? 0;
      this.tiltY = init.tiltY ?? 0;
      this.twist = init.twist ?? 0;
      this.isPrimary = init.isPrimary ?? false;
    }
  }
  (globalThis as Record<string, unknown>).PointerEvent = PointerEventPolyfill;
}

// ==================== Mocks ====================

type MockRenderedFeature = {
  id?: string | number;
  layer?: { id?: string };
  properties?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: number[] } | null;
};

const {
  mapPropsRef,
  mockMapFitBounds,
  mockGetMap,
  mockMapOnce: _mockMapOnce,
  mockDisableTouchRotation,
  mockSetBearing,
  mockSetPitch,
  mockMapHasImage,
  mockMapAddImage: _mockMapAddImage,
  mockMapLoadImage,
  mockMapGetCanvas,
  mockMapGetLayer,
  mockMapGetZoom,
  mockQueryRenderedFeatures,
  mockMapUnproject,
  mockMapFlyTo,
} = vi.hoisted(() => {
  const mapPropsRef = { current: null as Record<string, unknown> | null };
  const mockMapFitBounds = vi.fn();
  const mockMapOnce = vi.fn();
  const mockDisableTouchRotation = vi.fn();
  const mockSetBearing = vi.fn();
  const mockSetPitch = vi.fn();
  const mockMapHasImage = vi.fn(() => false);
  const mockMapAddImage = vi.fn();
  const mockMapGetCanvas = vi.fn(() => ({
    getBoundingClientRect: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 390,
      bottom: 844,
      width: 390,
      height: 844,
      toJSON: () => ({}),
    }),
  }));
  const mockQueryRenderedFeatures = vi.fn((): MockRenderedFeature[] => []);
  const mockMapGetLayer = vi.fn((id: string) => ({ id }));
  const mockMapGetZoom = vi.fn(() => 15);
  const mockMapLoadImage = vi.fn((_url: string, callback: (error: Error | null, image?: unknown) => void) => {
    callback(null, { width: 16, height: 16 });
  });
  const mockMapUnproject = vi.fn((point: { x: number; y: number }) => ({
    lng: 2.3 + point.x * 0.001,
    lat: 46.6 + point.y * 0.001,
  }));
  const mockMapFlyTo = vi.fn();
  const mockGetMap = vi.fn(() => ({
    once: mockMapOnce,
    touchZoomRotate: { disableRotation: mockDisableTouchRotation },
    setBearing: mockSetBearing,
    setPitch: mockSetPitch,
    hasImage: mockMapHasImage,
    addImage: mockMapAddImage,
    loadImage: mockMapLoadImage,
    getCanvas: mockMapGetCanvas,
    getLayer: mockMapGetLayer,
    getZoom: mockMapGetZoom,
    queryRenderedFeatures: mockQueryRenderedFeatures,
    unproject: mockMapUnproject,
    flyTo: mockMapFlyTo,
  }));

  return {
    mapPropsRef,
    mockMapFitBounds,
    mockGetMap,
    mockMapOnce,
    mockDisableTouchRotation,
    mockSetBearing,
    mockSetPitch,
    mockMapHasImage,
    mockMapAddImage,
    mockMapLoadImage,
    mockMapGetCanvas,
    mockMapGetLayer,
    mockMapGetZoom,
    mockQueryRenderedFeatures,
    mockMapUnproject,
    mockMapFlyTo,
  };
});

const { mockGetCachedLayerStyle } = vi.hoisted(() => ({
  mockGetCachedLayerStyle: vi.fn(),
}));

vi.mock('@ionic/react', () => ({
  IonPage: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="ion-page">{children}</div>
  ),
  IonContent: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="ion-content">{children}</div>
  ),
  IonModal: ({
    children,
    isOpen,
  }: {
    children?: React.ReactNode;
    isOpen?: boolean;
  }) => (isOpen ? <div data-testid="ion-modal">{children}</div> : null),
  IonToggle: ({ checked, onIonChange, children, ...rest }: {
    checked?: boolean;
    onIonChange?: (e: { detail: { checked: boolean } }) => void;
    children?: React.ReactNode;
  } & Record<string, unknown>) => (
    <label data-testid={rest['data-testid'] as string} aria-label={rest['aria-label'] as string}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onIonChange?.({ detail: { checked: e.target.checked } })}
      />
      {children}
    </label>
  ),
  IonIcon: () => <span data-testid="ion-icon" />,
}));

const {
  mockRequestPermissions,
  mockWatchPosition,
  mockClearWatch,
  locationWatchCallbackRef,
  appStateCallbackRef,
  headingCallbackRef,
  mockStartHeading,
  mockStopHeading,
} = vi.hoisted(() => ({
  mockRequestPermissions: vi.fn().mockResolvedValue({ location: 'granted' }),
  mockWatchPosition: vi.fn(),
  mockClearWatch: vi.fn().mockResolvedValue(undefined),
  locationWatchCallbackRef: { current: null as ((position: unknown, error?: unknown) => void) | null },
  appStateCallbackRef: { current: null as ((state: { isActive: boolean }) => void) | null },
  headingCallbackRef: { current: null as ((event: { value: number }) => void) | null },
  mockStartHeading: vi.fn().mockResolvedValue(undefined),
  mockStopHeading: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'android', isNativePlatform: () => true },
  registerPlugin: () => ({ logTiming: vi.fn(async () => {}) }),
}));

vi.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    requestPermissions: mockRequestPermissions,
    watchPosition: mockWatchPosition,
    clearWatch: mockClearWatch,
  },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    getState: vi.fn(async () => ({ isActive: true })),
    addListener: vi.fn(async (
      _name: string,
      listener: (state: { isActive: boolean }) => void,
    ) => {
      appStateCallbackRef.current = listener;
      return { remove: vi.fn(async () => { appStateCallbackRef.current = null; }) };
    }),
  },
}));

vi.mock('@capgo/capacitor-compass', () => ({
  CapgoCompass: {
    addListener: vi.fn(async (_name: string, listener: (event: { value: number }) => void) => {
      headingCallbackRef.current = listener;
      return { remove: vi.fn(async () => { headingCallbackRef.current = null; }) };
    }),
    startListening: mockStartHeading,
    stopListening: mockStopHeading,
  },
}));

vi.mock('@capacitor/haptics', () => ({
  Haptics: {
    impact: vi.fn().mockResolvedValue(undefined),
    notification: vi.fn().mockResolvedValue(undefined),
    selectionStart: vi.fn().mockResolvedValue(undefined),
    selectionChanged: vi.fn().mockResolvedValue(undefined),
    selectionEnd: vi.fn().mockResolvedValue(undefined),
  },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
  NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
}));

// Mock maplibre-gl (used by TileCacheService)
vi.mock('maplibre-gl', () => ({
  default: {
    addProtocol: vi.fn(),
    setWorkerUrl: vi.fn(),
  },
}));

vi.mock('../components/AppTabBar', () => ({
  default: ({
    onDashboardPanelChange,
    onTabPress,
  }: {
    onDashboardPanelChange?: (panel: DashboardPanel) => void;
    onTabPress?: () => void;
  }) => (
    <div data-testid="app-tab-bar">
      <button data-testid="projects-tab" onClick={() => { onTabPress?.(); onDashboardPanelChange?.('projects'); }}>Projects</button>
      <button data-testid="gps-tab" onClick={() => { onTabPress?.(); onDashboardPanelChange?.('gps'); }}>GPS</button>
      <button data-testid="map-tab" onClick={() => { onTabPress?.(); onDashboardPanelChange?.(null); }}>Map</button>
    </div>
  ),
}));

// Mock react-map-gl/maplibre
vi.mock('react-map-gl/maplibre', () => {
  const MapMock = React.forwardRef(
    (
      { children, ...mapProps }: { children?: React.ReactNode } & Record<string, unknown>,
      ref: React.Ref<unknown>,
    ) => {
      mapPropsRef.current = mapProps;

      React.useImperativeHandle(ref, () => ({
        fitBounds: mockMapFitBounds,
        getMap: mockGetMap,
      }));

      React.useEffect(() => {
        const onLoad = mapProps.onLoad;
        if (typeof onLoad === 'function') onLoad();
      }, [mapProps.onLoad]);

      return (
        <div
          data-testid="map"
          onClick={() => {
            const onClick = mapProps.onClick;
            if (typeof onClick === 'function') {
              onClick({
                point: { x: 120, y: 80 },
              });
            }
          }}
        >
          {children}
        </div>
      );
    },
  );
  MapMock.displayName = 'MapMock';

  return {
    default: MapMock,
    Source: ({ children, id, data }: {
      children?: React.ReactNode;
      id?: string;
      data?: unknown;
    }) => (
      <div data-testid="map-source" data-source-id={id} data-source-data={JSON.stringify(data)}>
        {children}
      </div>
    ),
    Layer: ({
      id,
      paint,
      filter,
      layout,
      minzoom,
      beforeId,
    }: {
      id?: string;
      paint?: Record<string, unknown>;
      filter?: unknown;
      layout?: Record<string, unknown>;
      minzoom?: number;
      beforeId?: string;
    }) => {
      const lineColor = paint?.['line-color'];
      const fillColor = paint?.['fill-color'];
      const circleColor = paint?.['circle-color'];
      const textColor = paint?.['text-color'];
      const layerColor = [lineColor, fillColor, circleColor].find(
        (value): value is string => typeof value === 'string',
      ) ?? '';
      const layerColorExpression = [lineColor, fillColor, circleColor].find(
        (value) => value !== undefined && typeof value !== 'string',
      );
      const textColorValue = typeof textColor === 'string' ? textColor : '';
      const textColorExpression =
        textColor !== undefined && typeof textColor !== 'string' ? textColor : undefined;
      const iconImage = typeof layout?.['icon-image'] === 'string'
        ? layout['icon-image']
        : '';
      const layerFilter = filter ? JSON.stringify(filter) : '';
      const layerText = layout && 'text-field' in layout
        ? JSON.stringify(layout['text-field'])
        : '';
      const layerMinzoom = typeof minzoom === 'number' ? String(minzoom) : '';
      const layerBeforeId = typeof beforeId === 'string' ? beforeId : '';

      return (
        <div
          data-testid="map-layer"
          data-layer-id={id}
          data-layer-color={layerColor}
          data-layer-color-expression={layerColorExpression ? JSON.stringify(layerColorExpression) : ''}
          data-layer-text-color={textColorValue}
          data-layer-text-color-expression={textColorExpression ? JSON.stringify(textColorExpression) : ''}
          data-layer-filter={layerFilter}
          data-layer-icon={iconImage}
          data-layer-text={layerText}
          data-layer-minzoom={layerMinzoom}
          data-layer-before-id={layerBeforeId}
        />
      );
    },
    Marker: ({ children, longitude, latitude }: {
      children?: React.ReactNode;
      longitude: number;
      latitude: number;
    }) => (
      <div data-testid="user-location-marker" data-longitude={longitude} data-latitude={latitude}>
        {children}
      </div>
    ),
    NavigationControl: () => <div data-testid="nav-control" />,
  };
});

// Mock TileCacheService
vi.mock('../services/TileCacheService', () => ({
  registerTileCacheProtocol: vi.fn(),
  getCachedStyle: vi.fn().mockResolvedValue({
    version: 8,
    sources: {},
    layers: [],
  }),
  getCachedLayerStyle: mockGetCachedLayerStyle,
}));

const {
  mockGetProjectVisibilityPreferences,
  mockSetProjectVisibilityPreference,
  mockSetProjectVisibilityPreferences,
  mockGetCountryVisibilityPreferences,
  mockSetCountryVisibilityPreference,
  mockSetCountryVisibilityPreferences,
  mockGetCountryCollapsedPreferences,
  mockSetCountryCollapsedPreference,
  mockGetLandmarkCollectionVisibilityPreferences,
  mockSetLandmarkCollectionVisibilityPreference,
  mockSetLandmarkCollectionVisibilityPreferences,
  mockGetLandmarkCollectionCollapsedPreferences,
  mockSetLandmarkCollectionCollapsedPreference,
  mockGetGpsTrackVisibilityPreferences,
  mockSetGpsTrackVisibilityPreference,
  mockGetShowLandmarks,
  mockSetShowLandmarks,
  mockSetSelectedMapLayerId,
} = vi.hoisted(() => ({
  mockGetProjectVisibilityPreferences: vi.fn(() => ({}) as Record<string, boolean>),
  mockSetProjectVisibilityPreference: vi.fn(),
  mockSetProjectVisibilityPreferences: vi.fn(),
  mockGetCountryVisibilityPreferences: vi.fn(() => ({}) as Record<string, boolean>),
  mockSetCountryVisibilityPreference: vi.fn(),
  mockSetCountryVisibilityPreferences: vi.fn(),
  mockGetCountryCollapsedPreferences: vi.fn(() => ({}) as Record<string, boolean>),
  mockSetCountryCollapsedPreference: vi.fn(),
  mockGetLandmarkCollectionVisibilityPreferences: vi.fn(() => ({}) as Record<string, boolean>),
  mockSetLandmarkCollectionVisibilityPreference: vi.fn(),
  mockSetLandmarkCollectionVisibilityPreferences: vi.fn(),
  mockGetLandmarkCollectionCollapsedPreferences: vi.fn(() => ({}) as Record<string, boolean>),
  mockSetLandmarkCollectionCollapsedPreference: vi.fn(),
  mockGetGpsTrackVisibilityPreferences: vi.fn(() => ({}) as Record<string, boolean>),
  mockSetGpsTrackVisibilityPreference: vi.fn(),
  mockGetShowLandmarks: vi.fn(() => true),
  mockSetShowLandmarks: vi.fn(),
  mockSetSelectedMapLayerId: vi.fn(),
}));

const { mockRestartGuidedTourFromHelp } = vi.hoisted(() => ({
  mockRestartGuidedTourFromHelp: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/PreferencesService', () => ({
  getProjectVisibilityPreferences: mockGetProjectVisibilityPreferences,
  setProjectVisibilityPreference: mockSetProjectVisibilityPreference,
  setProjectVisibilityPreferences: mockSetProjectVisibilityPreferences,
  getCountryVisibilityPreferences: mockGetCountryVisibilityPreferences,
  setCountryVisibilityPreference: mockSetCountryVisibilityPreference,
  setCountryVisibilityPreferences: mockSetCountryVisibilityPreferences,
  getCountryCollapsedPreferences: mockGetCountryCollapsedPreferences,
  setCountryCollapsedPreference: mockSetCountryCollapsedPreference,
  getLandmarkCollectionVisibilityPreferences: mockGetLandmarkCollectionVisibilityPreferences,
  setLandmarkCollectionVisibilityPreference: mockSetLandmarkCollectionVisibilityPreference,
  setLandmarkCollectionVisibilityPreferences: mockSetLandmarkCollectionVisibilityPreferences,
  getLandmarkCollectionCollapsedPreferences: mockGetLandmarkCollectionCollapsedPreferences,
  setLandmarkCollectionCollapsedPreference: mockSetLandmarkCollectionCollapsedPreference,
  getGpsTrackVisibilityPreferences: mockGetGpsTrackVisibilityPreferences,
  setGpsTrackVisibilityPreference: mockSetGpsTrackVisibilityPreference,
  getShowLandmarks: mockGetShowLandmarks,
  setShowLandmarks: mockSetShowLandmarks,
  setSelectedMapLayerId: mockSetSelectedMapLayerId,
}));

vi.mock('../onboarding/guidedTour/engine', () => ({
  restartGuidedTourFromHelp: mockRestartGuidedTourFromHelp,
}));

// Mock SpeleoDBProvider
const mockSyncProjects = vi.fn().mockResolvedValue({ status: 'done' });
const mockGetProjectGeoJSON = vi.fn().mockResolvedValue(null);
const mockGetProjectMapData = vi.fn(async (projectId: string) => {
  const featureCollection = normalizeGeoJSON(await mockGetProjectGeoJSON(projectId));
  if (!featureCollection) return null;
  try {
    return {
      commitId: mockProjects.find((project) => project.id === projectId)?.latest_commit.id ?? 'commit-1',
      featureCollection,
      bounds: measureProjectGeoJSONBounds(featureCollection).bounds,
    };
  } catch {
    return null;
  }
});
const mockGetOverlayGeoJSON = vi.fn().mockResolvedValue(null);
const mockLogout = vi.fn();
const mockIsAuthenticated = vi.fn().mockReturnValue(true);
const mockGetLandmarkCollections = vi.fn().mockResolvedValue([]);
const mockCreateLandmark = vi.fn().mockResolvedValue({ id: 'lm-new' });
const mockUpdateLandmark = vi.fn().mockResolvedValue({ id: 'lm-1' });
const mockDeleteLandmark = vi.fn().mockResolvedValue(undefined);
let mockIsOfflineLocked = false;
let mockProjects: Project[] = [];
let mockLandmarksRevision = 0;
let mockMapDataRevision = 1;
let mockGpsRecordingState: 'idle' | 'recording' | 'paused' = 'idle';
let mockGpsTracks: GpsTrackListItem[] = [];
const mockController = {
  syncProjects: mockSyncProjects,
  getProjectGeoJSON: mockGetProjectGeoJSON,
  getProjectMapData: mockGetProjectMapData,
  getOverlayGeoJSON: mockGetOverlayGeoJSON,
  logout: mockLogout,
  isAuthenticated: mockIsAuthenticated,
  getLandmarkCollections: mockGetLandmarkCollections,
  createLandmark: mockCreateLandmark,
  updateLandmark: mockUpdateLandmark,
  deleteLandmark: mockDeleteLandmark,
  // GPS recording surface (defaults are inert for non-GPS Dashboard tests).
  currentTrackPoints: [] as RecordedPoint[],
  startTrackRecording: vi.fn().mockResolvedValue(undefined),
  pauseTrackRecording: vi.fn().mockResolvedValue(undefined),
  resumeTrackRecording: vi.fn().mockResolvedValue(undefined),
  stopTrackRecording: vi.fn().mockResolvedValue(null),
  discardTrackRecording: vi.fn().mockResolvedValue(undefined),
  removeGpsTrack: vi.fn().mockResolvedValue(undefined),
  editGpsTrack: vi.fn().mockResolvedValue(undefined),
  uploadGpsTrack: vi.fn().mockResolvedValue(undefined),
  syncGpsTracks: vi.fn().mockResolvedValue(undefined),
  buildGpxFileForTrack: vi.fn().mockResolvedValue({ fileName: 'track.gpx', gpx: '<gpx/>' }),
  getGpsTrackPoints: vi.fn().mockResolvedValue([]),
  isOfflineLocked: false,
};

vi.mock('../context/useSpeleoDB', () => ({
  useSpeleoDB: () => ({
    controller: mockController,
    projects: mockProjects,
    syncStatus: 'idle' as const,
    isOnline: true,
    isOfflineLocked: mockIsOfflineLocked,
    mapDataRevision: mockMapDataRevision,
    tilePrefetchJobs: [],
    landmarksRevision: mockLandmarksRevision,
    gpsTracks: mockGpsTracks,
    gpsRecordingState: mockGpsRecordingState,
    gpsRecordingStartedAt: mockGpsRecordingState === 'idle' ? null : Date.now() - 30_000,
    gpsRecordingElapsedMs: mockGpsRecordingState === 'idle' ? 0 : 30_000,
    gpsRecordingElapsedUpdatedAt: mockGpsRecordingState === 'recording' ? Date.now() : null,
    gpsTracksRevision: 0,
  }),
}));

// ==================== Helpers ====================

function renderDashboard(options?: {
  showLandmarks?: boolean;
  colorMode?: 'project' | 'depth';
  measurementUnit?: 'feet' | 'meters';
  selectedMapLayerId?: 'esri-satellite' | 'esri-world-hillshade' | 'esri-world-hillshade-dark';
  layerOfflineSync?: Record<string, boolean>;
  routeActive?: boolean;
}) {
  const history = createMemoryHistory({ initialEntries: ['/dashboard'] });
  const initialShowLandmarks = options?.showLandmarks ?? mockGetShowLandmarks();
  const initialColorMode = options?.colorMode ?? 'project';
  const initialMeasurementUnit = options?.measurementUnit ?? 'feet';
  const initialLayerId = options?.selectedMapLayerId ?? 'esri-satellite';
  const initialLayerOfflineSync = options?.layerOfflineSync ?? {};
  let routeActive = options?.routeActive ?? true;
  const Harness: React.FC = () => {
    const [activeDashboardPanel, setActiveDashboardPanel] =
      React.useState<DashboardPanel>(null);
    const [showLandmarks] = React.useState(initialShowLandmarks);
    const [selectedMapLayerId, setSelectedMapLayerId] = React.useState(initialLayerId);
    return (
      <Dashboard
        isActive={routeActive}
        activeDashboardPanel={activeDashboardPanel}
        onDashboardPanelChange={setActiveDashboardPanel}
        showLandmarks={showLandmarks}
        colorMode={initialColorMode}
        measurementUnit={initialMeasurementUnit}
        selectedMapLayerId={selectedMapLayerId}
        onSelectedMapLayerIdChange={setSelectedMapLayerId}
        layerOfflineSync={initialLayerOfflineSync}
      />
    );
  };
  const view = render(
    <Router history={history}>
      <Harness />
    </Router>,
  );
  return Object.assign(history, {
    rerenderDashboard: () => view.rerender(
      <Router history={history}>
        <Harness />
      </Router>,
    ),
    setDashboardActive: (active: boolean) => {
      routeActive = active;
      view.rerender(
        <Router history={history}>
          <Harness />
        </Router>,
      );
    },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function simulatePointerTap(
  element: Element,
  clientX = 120,
  clientY = 80,
): void {
  fireEvent.pointerDown(element, {
    pointerId: 1,
    pointerType: 'touch',
    clientX,
    clientY,
  });
  fireEvent.pointerUp(element, {
    pointerId: 1,
    pointerType: 'touch',
    clientX,
    clientY,
  });
}

function getMapTouchSurface(): Element {
  const el = document.querySelector('.dashboard-map-touch-surface');
  if (!el) throw new Error('.dashboard-map-touch-surface not found');
  return el;
}

/**
 * Drain Dashboard's in-flight async geojson/overlay loaders inside act().
 *
 * Those effects do `await controller.getProjectGeoJSON(...)` then setState
 * (Dashboard.tsx setGeoJsonData / setActiveProjectIds / setOverlayGeoJsonData).
 * `await waitFor('.dashboard-map-touch-surface')` returns as soon as the surface
 * mounts -- before those microtask chains resolve -- so their setState can land
 * outside act() and trip the console guard. A single macrotask turn (real timer)
 * flushes the whole microtask chain; wrapping it in act() captures the updates.
 * Call this on REAL timers, before switching to fake timers.
 */
async function settleAsyncEffects(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Test Project',
    description: '',
    country: 'FR',
    color: '#377eb8',
    type: 'survey',
    visibility: 'public',
    is_active: true,
    created_by: 'user',
    creation_date: '2025-01-01',
    modified_date: '2025-01-01',
    commit_count: 1,
    active_mutex: null,
    fork_from: null,
    exclude_geojson: false,
    geojson_file: 'https://example.com/test.geojson',
    latest_commit: {
      id: 'c1',
      message: 'init',
      author_email: 'a@b.com',
      author_name: 'Author',
      authored_date: '2025-01-01',
      dt_since: '1 day ago',
      parent_ids: [],
      url: '',
      formats: [],
      tree: [],
    },
    ...overrides,
  };
}

function pointFeatureCollection(lng = 2.3, lat = 46.6): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Point',
          coordinates: [lng, lat],
        },
      },
    ],
  };
}

function overlayPointFeatureCollection(
  properties: Record<string, unknown> = {},
  lng = 2.3,
  lat = 46.6,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties,
        geometry: {
          type: 'Point',
          coordinates: [lng, lat],
        },
      },
    ],
  };
}

function lineFeatureCollection(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { section_name: 'Main line' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [2.3, 46.6],
            [2.31, 46.61],
          ],
        },
      },
    ],
  };
}

function lineFeatureCollectionWithDepth(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { section_name: 'Depth line' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [2.3, 46.6, -10],
            [2.31, 46.61, -25],
          ],
        },
      },
    ],
  };
}

function depthFeatureCollection(depthValue: number): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { _speleoDepth: depthValue },
        geometry: {
          type: 'LineString',
          coordinates: [
            [2.3, 46.6],
            [2.31, 46.61],
          ],
        },
      },
    ],
  };
}

function mixedProjectFeatureCollection(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { section_name: 'Main line' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [2.3, 46.6],
            [2.31, 46.61],
          ],
        },
      },
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Point',
          coordinates: [2.32, 46.62],
        },
      },
    ],
  };
}

// ==================== Tests ====================

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGpsRecordingState = 'idle';
    mockGpsTracks = [];
    mockController.currentTrackPoints = [];
    locationWatchCallbackRef.current = null;
    appStateCallbackRef.current = null;
    headingCallbackRef.current = null;
    mockRequestPermissions.mockReset().mockResolvedValue({ location: 'granted' });
    mockWatchPosition.mockReset().mockImplementation(
      async (_options: unknown, callback: (position: unknown, error?: unknown) => void) => {
        locationWatchCallbackRef.current = callback;
        return 'live-location-watch';
      },
    );
    mockClearWatch.mockReset().mockResolvedValue(undefined);
    mockStartHeading.mockReset().mockResolvedValue(undefined);
    mockStopHeading.mockReset().mockResolvedValue(undefined);
    mockGetCachedLayerStyle.mockResolvedValue({
      version: 8,
      sources: {},
      layers: [],
    });
    mockMapDataRevision = 1;
    mockGetProjectMapData.mockImplementation(async (projectId: string) => {
      const featureCollection = normalizeGeoJSON(await mockGetProjectGeoJSON(projectId));
      if (!featureCollection) return null;
      try {
        return {
          commitId: mockProjects.find((project) => project.id === projectId)?.latest_commit.id ?? 'commit-1',
          featureCollection,
          bounds: measureProjectGeoJSONBounds(featureCollection).bounds,
        };
      } catch {
        return null;
      }
    });
    mapPropsRef.current = null;
    mockIsAuthenticated.mockReturnValue(true);
    mockIsOfflineLocked = false;
    mockProjects = [];
    mockGetProjectVisibilityPreferences.mockReturnValue({});
    mockGetCountryVisibilityPreferences.mockReturnValue({});
    mockGetCountryCollapsedPreferences.mockReturnValue({});
    mockGetShowLandmarks.mockReturnValue(true);
    mockGetOverlayGeoJSON.mockResolvedValue(null);
    mockMapHasImage.mockReturnValue(false);
    mockMapGetCanvas.mockReturnValue({
      getBoundingClientRect: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 390,
        bottom: 844,
        width: 390,
        height: 844,
        toJSON: () => ({}),
      }),
    });
    mockQueryRenderedFeatures.mockReturnValue([]);
    mockMapGetLayer.mockImplementation((id: string) => ({ id }));
    mockMapGetZoom.mockReturnValue(15);
    mockMapLoadImage.mockImplementation((_url: string, callback: (error: Error | null, image?: unknown) => void) => {
      callback(null, { width: 16, height: 16 });
    });
  });

  it('renders the map when authenticated', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('map')).toBeInTheDocument();
    });
  });

  it('publishes and fits validated GeoJSON when cache data precedes map readiness', async () => {
    const style = deferred<Record<string, unknown>>();
    mockGetCachedLayerStyle.mockReturnValueOnce(style.promise);
    mockMapDataRevision = 0;
    mockProjects = [makeProject({ id: 'cached', name: 'Cached Cave' })];
    mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection(3, 47));

    renderDashboard();

    await waitFor(() => expect(mockGetProjectMapData).toHaveBeenCalledWith('cached'));
    expect(screen.queryByTestId('map')).not.toBeInTheDocument();
    expect(mockMapFitBounds).not.toHaveBeenCalled();

    await act(async () => {
      style.resolve({ version: 8, sources: {}, layers: [] });
      await style.promise;
    });

    await waitFor(() => expect(screen.getByTestId('map')).toBeInTheDocument());
    await waitFor(() => expect(mockMapFitBounds).toHaveBeenCalledOnce());
    expect(document.querySelector('[data-layer-id="project-cached-line"]')).not.toBeNull();
  });

  it('redirects to /login when not authenticated', () => {
    mockIsAuthenticated.mockReturnValue(false);
    const history = renderDashboard();
    return waitFor(() => {
      expect(history.location.pathname).toBe('/login');
    });
  });

  it('calls syncProjects on mount', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(mockSyncProjects).toHaveBeenCalledOnce();
    });
  });

  it('opens project panel when Projects tab is clicked', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('projects-tab')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId('projects-tab'));
    expect(screen.getByTestId('project-panel')).toBeInTheDocument();
  });

  it('does not render navigation control', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.queryByTestId('nav-control')).not.toBeInTheDocument();
    });
  });

  it('locks map orientation and disables rotation interactions', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('map')).toBeInTheDocument();
      expect(mapPropsRef.current).not.toBeNull();
    });

    const mapProps = mapPropsRef.current as Record<string, unknown>;
    expect(mapProps.dragRotate).toBe(false);
    expect(mapProps.touchPitch).toBe(false);
    expect(mapProps.pitchWithRotate).toBe(false);
    expect(mapProps.keyboard).toBe(false);
    expect(mapProps.maxPitch).toBe(0);

    const initialViewState = mapProps.initialViewState as Record<string, unknown>;
    expect(initialViewState.bearing).toBe(0);
    expect(initialViewState.pitch).toBe(0);

    await waitFor(() => {
      expect(mockDisableTouchRotation).toHaveBeenCalledOnce();
      expect(mockSetBearing).toHaveBeenCalledWith(0);
      expect(mockSetPitch).toHaveBeenCalledWith(0);
    });
  });

  it('renders distance scale overlay', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('distance-scale')).toBeInTheDocument();
    });
  });

  it('renders depth gauge only in depth mode', async () => {
    renderDashboard({ colorMode: 'depth' });
    await waitFor(() => {
      expect(screen.getByTestId('depth-gauge')).toBeInTheDocument();
    });
  });

  it('does not render depth gauge in project mode', async () => {
    renderDashboard({ colorMode: 'project' });
    await waitFor(() => {
      expect(screen.queryByTestId('depth-gauge')).not.toBeInTheDocument();
    });
  });

  it('uses depth color expressions for project line/fill layers in depth mode', async () => {
    mockProjects = [makeProject({ id: 'p-depth', name: 'Depth Color Project' })];
    mockGetProjectGeoJSON.mockResolvedValueOnce(lineFeatureCollectionWithDepth());

    renderDashboard({ colorMode: 'depth' });

    await waitFor(() => {
      const lineLayer = document.querySelector(
        '[data-layer-id="project-p-depth-line"]',
      ) as HTMLElement | null;
      expect(lineLayer).not.toBeNull();
      expect(lineLayer?.dataset.layerColorExpression).toContain('_speleoDepth');
    });
  });

  it('updates depth gauge from mouse hover in depth mode', async () => {
    mockProjects = [makeProject({ id: 'p1', name: 'Depth Hover Project' })];
    mockGetProjectGeoJSON.mockResolvedValueOnce(lineFeatureCollectionWithDepth());

    renderDashboard({ colorMode: 'depth' });

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="project-p1-line"]')).not.toBeNull();
      expect(screen.getByTestId('depth-gauge')).toBeInTheDocument();
      expect(mapPropsRef.current).not.toBeNull();
    });

    mockQueryRenderedFeatures.mockReturnValueOnce([
      {
        layer: { id: 'project-p1-line' },
        properties: { _speleoDepth: -22 },
      },
    ]);

    act(() => {
      const mapProps = mapPropsRef.current as Record<string, unknown>;
      const onMouseMove = mapProps.onMouseMove as ((event: { point: { x: number; y: number } }) => void) | undefined;
      onMouseMove?.({ point: { x: 120, y: 80 } });
    });

    expect(screen.getByTestId('depth-gauge-current')).toHaveTextContent('-22 ft');
  });

  it('updates and clears depth gauge with touch probe interactions', async () => {
    mockProjects = [makeProject({ id: 'p1', name: 'Depth Touch Project' })];
    mockGetProjectGeoJSON.mockResolvedValueOnce(lineFeatureCollectionWithDepth());

    renderDashboard({ colorMode: 'depth' });

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="project-p1-line"]')).not.toBeNull();
      expect(screen.getByTestId('depth-gauge')).toBeInTheDocument();
    });

    mockQueryRenderedFeatures.mockReturnValue([
      {
        layer: { id: 'project-p1-line' },
        properties: { _speleoDepth: -30 },
      },
    ]);

    const surface = getMapTouchSurface();
    fireEvent.pointerDown(surface, {
      pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 80,
    });
    fireEvent.pointerMove(surface, {
      pointerId: 1, pointerType: 'touch', clientX: 122, clientY: 82,
    });

    expect(screen.getByTestId('depth-gauge-current')).toHaveTextContent('-30 ft');

    fireEvent.pointerUp(surface, {
      pointerId: 1, pointerType: 'touch', clientX: 122, clientY: 82,
    });

    expect(screen.getByTestId('depth-gauge-current')).toHaveTextContent('');
  });

  it('converts depth gauge values to meters when metric unit is selected', async () => {
    mockProjects = [makeProject({ id: 'p1', name: 'Depth Metric Project' })];
    mockGetProjectGeoJSON.mockResolvedValueOnce(lineFeatureCollectionWithDepth());

    renderDashboard({ colorMode: 'depth', measurementUnit: 'meters' });

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="project-p1-line"]')).not.toBeNull();
      expect(screen.getByTestId('depth-gauge')).toBeInTheDocument();
      expect(mapPropsRef.current).not.toBeNull();
    });

    mockQueryRenderedFeatures.mockReturnValueOnce([
      {
        layer: { id: 'project-p1-line' },
        properties: { _speleoDepth: -30 },
      },
    ]);

    act(() => {
      const mapProps = mapPropsRef.current as Record<string, unknown>;
      const onMouseMove = mapProps.onMouseMove as ((event: { point: { x: number; y: number } }) => void) | undefined;
      onMouseMove?.({ point: { x: 120, y: 80 } });
    });

    expect(screen.getByTestId('depth-gauge-current')).toHaveTextContent('-9.1 m');
  });

  it('recalculates depth domain when a project is hidden in depth mode', async () => {
    mockProjects = [
      makeProject({ id: 'p1', name: 'Shallow Cave' }),
      makeProject({ id: 'p2', name: 'Deep Cave' }),
    ];
    mockGetProjectGeoJSON.mockImplementation(async (projectId: string) => {
      if (projectId === 'p1') return depthFeatureCollection(25);
      if (projectId === 'p2') return depthFeatureCollection(80);
      return null;
    });

    renderDashboard({ colorMode: 'depth' });

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="project-p1-line"]')).not.toBeNull();
      expect(document.querySelector('[data-layer-id="project-p2-line"]')).not.toBeNull();
      expect(screen.getByTestId('depth-gauge')).toBeInTheDocument();
    });

    expect(screen.getByTestId('depth-gauge-max')).toHaveTextContent('80 ft');

    await userEvent.click(screen.getByLabelText('Toggle Deep Cave'));

    await waitFor(() => {
      expect(screen.getByTestId('depth-gauge-max')).toHaveTextContent('25 ft');
    });
  });

  it('recalculates depth domain when a project is shown in depth mode', async () => {
    mockProjects = [
      makeProject({ id: 'p1', name: 'Shallow Cave' }),
      makeProject({ id: 'p2', name: 'Deep Cave' }),
    ];
    mockGetProjectGeoJSON.mockImplementation(async (projectId: string) => {
      if (projectId === 'p1') return depthFeatureCollection(25);
      if (projectId === 'p2') return depthFeatureCollection(80);
      return null;
    });
    mockGetProjectVisibilityPreferences.mockReturnValue({ p1: true, p2: false });

    renderDashboard({ colorMode: 'depth' });

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="project-p1-line"]')).not.toBeNull();
      expect(screen.getByTestId('depth-gauge')).toBeInTheDocument();
    });

    expect(screen.getByTestId('depth-gauge-max')).toHaveTextContent('25 ft');

    await userEvent.click(screen.getByLabelText('Toggle Deep Cave'));

    await waitFor(() => {
      expect(screen.getByTestId('depth-gauge-max')).toHaveTextContent('80 ft');
    });
  });

  it('shows N/A depth domain when all projects are hidden in depth mode', async () => {
    mockProjects = [
      makeProject({ id: 'p1', name: 'Only Cave' }),
    ];
    mockGetProjectGeoJSON.mockResolvedValue(depthFeatureCollection(50));

    renderDashboard({ colorMode: 'depth' });

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="project-p1-line"]')).not.toBeNull();
      expect(screen.getByTestId('depth-gauge')).toBeInTheDocument();
    });

    expect(screen.getByTestId('depth-gauge-max')).toHaveTextContent('50 ft');

    await userEvent.click(screen.getByLabelText('Toggle Only Cave'));

    await waitFor(() => {
      expect(screen.getByTestId('depth-gauge-max')).toHaveTextContent('N/A');
      expect(screen.getByTestId('depth-gauge-min')).toHaveTextContent('N/A');
    });
  });

  it('renders GeoJSON layer when payload is a JSON string', async () => {
    mockProjects = [makeProject({ id: 'p-json', name: 'JSON String Project' })];
    mockGetProjectGeoJSON.mockResolvedValueOnce(JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Point',
            coordinates: [2.3, 46.6],
          },
        },
      ],
    }));

    renderDashboard();

    await waitFor(() => {
      expect(mockGetProjectGeoJSON).toHaveBeenCalledWith('p-json');
      expect(document.querySelector('[data-layer-id="project-p-json-point"]')).not.toBeNull();
    });
  });

  it('renders project Point features as star symbols (Django parity)', async () => {
    mockProjects = [makeProject({ id: 'p-star', name: 'Star Project' })];
    mockGetProjectGeoJSON.mockResolvedValueOnce({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Point',
            coordinates: [2.3, 46.6],
          },
        },
      ],
    });

    renderDashboard();

    await waitFor(() => {
      const pointLayer = document.querySelector(
        '[data-layer-id="project-p-star-point"]',
      ) as HTMLElement | null;
      expect(pointLayer).not.toBeNull();
      expect(pointLayer?.dataset.layerText).toContain('★');
      expect(pointLayer?.dataset.layerMinzoom).toBe('5');
    });
  });

  it('keeps project line layer visible from zoom level 0', async () => {
    mockProjects = [makeProject({ id: 'p-line', name: 'Line Project' })];
    mockGetProjectGeoJSON.mockResolvedValueOnce(lineFeatureCollection());

    renderDashboard();

    await waitFor(() => {
      const lineLayer = document.querySelector(
        '[data-layer-id="project-p-line-line"]',
      ) as HTMLElement | null;
      expect(lineLayer).not.toBeNull();
      expect(lineLayer?.dataset.layerMinzoom).toBe('0');
    });
  });

  it('keeps project GeoJSON layers anchored below marker layers', async () => {
    mockProjects = [makeProject({ id: 'p-order', name: 'Order Project' })];
    mockGetProjectGeoJSON.mockResolvedValueOnce(mixedProjectFeatureCollection());

    renderDashboard();

    await waitFor(() => {
      const fillLayer = document.querySelector(
        '[data-layer-id="project-p-order-fill"]',
      ) as HTMLElement | null;
      const lineLayer = document.querySelector(
        '[data-layer-id="project-p-order-line"]',
      ) as HTMLElement | null;
      const pointLayer = document.querySelector(
        '[data-layer-id="project-p-order-point"]',
      ) as HTMLElement | null;

      expect(fillLayer?.dataset.layerBeforeId).toBe('project-layer-order-anchor');
      expect(lineLayer?.dataset.layerBeforeId).toBe('project-layer-order-anchor');
      expect(pointLayer?.dataset.layerBeforeId).toBe('project-layer-order-anchor');
    });
  });

  it('renders cached overlay sources/layers with Django-style icon contracts', async () => {
    mockProjects = [makeProject({ id: 'p1', name: 'Overlay Project' })];
    mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());
    mockGetOverlayGeoJSON.mockImplementation(async (overlayId: string) => {
      if (overlayId === 'landmarks') return overlayPointFeatureCollection();
      if (overlayId === 'surfaceStations') {
        return overlayPointFeatureCollection({ tag: { color: '#f97316' } });
      }
      if (overlayId === 'subsurfaceStations') {
        return overlayPointFeatureCollection({ type: 'biology', color: '#f97316', project: 'p1' });
      }
      if (overlayId === 'explorationLeads') return overlayPointFeatureCollection({ project: 'p1' });
      if (overlayId === 'cylinderInstalls') {
        return overlayPointFeatureCollection({
          project_id: 'p1',
          install_date: '2026-02-17',
          pressure: 230,
          pressure_unit_system: 'metric',
        });
      }
      return null;
    });

    renderDashboard();

    await waitFor(() => {
      expect(mockGetOverlayGeoJSON).toHaveBeenCalledWith('landmarks');
      expect(mockGetOverlayGeoJSON).toHaveBeenCalledWith('subsurfaceStations');
      expect(mockGetOverlayGeoJSON).toHaveBeenCalledWith('surfaceStations');
      expect(mockGetOverlayGeoJSON).toHaveBeenCalledWith('explorationLeads');
      expect(mockGetOverlayGeoJSON).toHaveBeenCalledWith('cylinderInstalls');
      expect(document.querySelector('[data-layer-id="landmarks-layer"]')).not.toBeNull();
      expect(document.querySelector('[data-layer-id="landmarks-labels"]')).not.toBeNull();
      expect(document.querySelector('[data-layer-id="surface-stations-layer"]')).not.toBeNull();
      expect(document.querySelector('[data-layer-id="surface-stations-labels"]')).not.toBeNull();
      expect(document.querySelector('[data-layer-id="subsurface-stations-circles"]')).not.toBeNull();
      expect(document.querySelector('[data-layer-id="subsurface-stations-biology-icons"]')).not.toBeNull();
      expect(document.querySelector('[data-layer-id="subsurface-stations-labels"]')).not.toBeNull();
      expect(document.querySelector('[data-layer-id="exploration-leads-icon-layer"]')).not.toBeNull();
      expect(document.querySelector('[data-layer-id="cylinder-installs-icon-layer"]')).not.toBeNull();
      expect(document.querySelector('[data-layer-id="cylinder-installs-labels"]')).not.toBeNull();
    });

    const subsurfaceCircleLayer = document.querySelector(
      '[data-layer-id="subsurface-stations-circles"]',
    ) as HTMLElement | null;
    expect(subsurfaceCircleLayer?.dataset.layerFilter).toContain('"sensor"');

    const biologyLayer = document.querySelector(
      '[data-layer-id="subsurface-stations-biology-icons"]',
    ) as HTMLElement | null;
    expect(biologyLayer?.dataset.layerIcon).toBe('biology-station-icon');

    const cylinderLabelLayer = document.querySelector(
      '[data-layer-id="cylinder-installs-labels"]',
    ) as HTMLElement | null;
    expect(cylinderLabelLayer?.dataset.layerText).toContain('install_date');
  });

  it('uses fallback non-icon layers for exploration leads and cylinders when icons fail to load', async () => {
    allowConsoleWarn(
      'Failed to load a map icon.',
      expect.any(Error),
    );
    allowConsoleWarn(
      'Failed to load a map icon.',
      expect.any(Error),
    );
    mockProjects = [makeProject({ id: 'p1', name: 'Fallback Project' })];
    mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());
    mockMapLoadImage.mockImplementation((url: string, callback: (error: Error | null, image?: unknown) => void) => {
      if (url.includes('exploration-lead-icon') || url.includes('cylinder-orange-icon')) {
        callback(new Error('image load failed'));
        return;
      }
      callback(null, { width: 16, height: 16 });
    });
    mockGetOverlayGeoJSON.mockImplementation(async (overlayId: string) => {
      if (overlayId === 'explorationLeads') {
        return overlayPointFeatureCollection({ project: 'p1' });
      }
      if (overlayId === 'cylinderInstalls') {
        return overlayPointFeatureCollection({ project_id: 'p1' });
      }
      return null;
    });

    renderDashboard();

    await waitFor(() => {
      const explorationLayer = document.querySelector(
        '[data-layer-id="exploration-leads-fallback-layer"]',
      ) as HTMLElement | null;
      const cylinderLayer = document.querySelector(
        '[data-layer-id="cylinder-installs-fallback-layer"]',
      ) as HTMLElement | null;
      expect(explorationLayer).not.toBeNull();
      expect(cylinderLayer).not.toBeNull();
      expect(explorationLayer?.dataset.layerIcon).toBe('');
      expect(cylinderLayer?.dataset.layerIcon).toBe('');
    });
  });

  it('opens marker details modal when tapping an exploration lead icon marker', async () => {
    mockProjects = [makeProject({ id: 'p1', name: 'Lead Project' })];
    mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());
    mockGetOverlayGeoJSON.mockImplementation(async (overlayId: string) => {
      if (overlayId === 'explorationLeads') {
        return overlayPointFeatureCollection({ project: 'p1' });
      }
      return null;
    });

    renderDashboard();

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="exploration-leads-icon-layer"]')).not.toBeNull();
    });

    mockQueryRenderedFeatures.mockReturnValueOnce([
      {
        layer: { id: 'exploration-leads-icon-layer' },
        properties: { id: 'lead-1', description: 'lead ne, but might just go to the line' },
      },
    ]);

    simulatePointerTap(getMapTouchSurface());

    expect(mockQueryRenderedFeatures).toHaveBeenCalled();
    expect(screen.getByTestId('overlay-marker-details-modal')).toBeInTheDocument();
    expect(screen.getByTestId('overlay-marker-description')).toHaveTextContent(
      'lead ne, but might just go to the line',
    );
  });

  it('does not open marker details modal when pointer interaction is a drag', async () => {
    mockProjects = [makeProject({ id: 'p1', name: 'Drag Project' })];
    mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());
    mockGetOverlayGeoJSON.mockImplementation(async (overlayId: string) => {
      if (overlayId === 'explorationLeads') {
        return overlayPointFeatureCollection({ project: 'p1' });
      }
      return null;
    });

    renderDashboard();

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="exploration-leads-icon-layer"]')).not.toBeNull();
    });

    const surface = getMapTouchSurface();

    fireEvent.pointerDown(surface, {
      pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 80,
    });
    fireEvent.pointerMove(surface, {
      pointerId: 1, pointerType: 'touch', clientX: 170, clientY: 80,
    });
    fireEvent.pointerUp(surface, {
      pointerId: 1, pointerType: 'touch', clientX: 170, clientY: 80,
    });

    expect(mockQueryRenderedFeatures).not.toHaveBeenCalled();
    expect(screen.queryByTestId('overlay-marker-details-modal')).not.toBeInTheDocument();
  });

  it('does not open marker details modal when tapping a marker below minimum zoom', async () => {
    mockMapGetZoom.mockReturnValue(MAP.MARKER_INTERACTION_MIN_ZOOM - 1);
    mockProjects = [makeProject({ id: 'p1', name: 'Low Zoom Tap Project' })];
    mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());
    mockGetOverlayGeoJSON.mockImplementation(async (overlayId: string) => {
      if (overlayId === 'explorationLeads') {
        return overlayPointFeatureCollection({ project: 'p1' });
      }
      return null;
    });

    renderDashboard();

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="exploration-leads-icon-layer"]')).not.toBeNull();
    });

    simulatePointerTap(getMapTouchSurface());

    expect(mockQueryRenderedFeatures).not.toHaveBeenCalled();
    expect(screen.queryByTestId('overlay-marker-details-modal')).not.toBeInTheDocument();
  });

  it('opens marker details modal when tapping a marker at minimum zoom', async () => {
    mockMapGetZoom.mockReturnValue(MAP.MARKER_INTERACTION_MIN_ZOOM);
    mockProjects = [makeProject({ id: 'p1', name: 'Boundary Zoom Tap Project' })];
    mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());
    mockGetOverlayGeoJSON.mockImplementation(async (overlayId: string) => {
      if (overlayId === 'explorationLeads') {
        return overlayPointFeatureCollection({ project: 'p1' });
      }
      return null;
    });

    renderDashboard();

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="exploration-leads-icon-layer"]')).not.toBeNull();
    });

    mockQueryRenderedFeatures.mockReturnValueOnce([
      {
        layer: { id: 'exploration-leads-icon-layer' },
        properties: { id: 'lead-1', description: 'visible at boundary' },
      },
    ]);

    simulatePointerTap(getMapTouchSurface());

    expect(mockQueryRenderedFeatures).toHaveBeenCalled();
    expect(screen.getByTestId('overlay-marker-details-modal')).toBeInTheDocument();
  });

  it('opens marker details modal when tapping an exploration lead fallback marker', async () => {
    mockProjects = [makeProject({ id: 'p1', name: 'Lead Fallback Project' })];
    mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());
    mockMapLoadImage.mockImplementation((url: string, callback: (error: Error | null, image?: unknown) => void) => {
      if (url.includes('exploration-lead-icon')) {
        callback(new Error('image load failed'));
        return;
      }
      callback(null, { width: 16, height: 16 });
    });
    mockGetOverlayGeoJSON.mockImplementation(async (overlayId: string) => {
      if (overlayId === 'explorationLeads') {
        return overlayPointFeatureCollection({ project: 'p1' });
      }
      return null;
    });

    renderDashboard();

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="exploration-leads-fallback-layer"]')).not.toBeNull();
    });

    mockQueryRenderedFeatures.mockReturnValueOnce([
      {
        layer: { id: 'exploration-leads-fallback-layer' },
        properties: { description: 'fallback lead description' },
      },
    ]);

    simulatePointerTap(getMapTouchSurface());

    expect(screen.getByTestId('overlay-marker-details-modal')).toBeInTheDocument();
    expect(screen.getByTestId('overlay-marker-description')).toHaveTextContent(
      'fallback lead description',
    );
  });

  it('opens marker details modal with formatted cylinder fields for icon markers', async () => {
    mockProjects = [makeProject({ id: 'p1', name: 'Cylinder Project' })];
    mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());
    mockGetOverlayGeoJSON.mockImplementation(async (overlayId: string) => {
      if (overlayId === 'cylinderInstalls') {
        return overlayPointFeatureCollection({ project_id: 'p1' });
      }
      return null;
    });

    renderDashboard();

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="cylinder-installs-icon-layer"]')).not.toBeNull();
    });

    mockQueryRenderedFeatures.mockReturnValueOnce([
      {
        layer: { id: 'cylinder-installs-icon-layer' },
        properties: {
          id: 'cyl-1',
          pressure: 3000,
          pressure_unit_system: 'imperial',
          o2_percentage: 32,
          he_percentage: 0,
          install_date: '2026-02-17',
        },
      },
    ]);

    simulatePointerTap(getMapTouchSurface());

    expect(screen.getByTestId('overlay-marker-details-modal')).toBeInTheDocument();
    expect(screen.getByTestId('overlay-marker-pressure')).toHaveTextContent('3000 PSI');
    expect(screen.getByTestId('overlay-marker-gas-mix')).toHaveTextContent('NX32');
    expect(screen.getByTestId('overlay-marker-install-date')).toHaveTextContent('2026-02-17');
  });

  it('opens marker details modal for cylinder fallback markers and handles malformed properties', async () => {
    mockProjects = [makeProject({ id: 'p1', name: 'Cylinder Fallback Project' })];
    mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());
    mockMapLoadImage.mockImplementation((url: string, callback: (error: Error | null, image?: unknown) => void) => {
      if (url.includes('cylinder-orange-icon')) {
        callback(new Error('image load failed'));
        return;
      }
      callback(null, { width: 16, height: 16 });
    });
    mockGetOverlayGeoJSON.mockImplementation(async (overlayId: string) => {
      if (overlayId === 'cylinderInstalls') {
        return overlayPointFeatureCollection({ project_id: 'p1' });
      }
      return null;
    });

    renderDashboard();

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="cylinder-installs-fallback-layer"]')).not.toBeNull();
    });

    mockQueryRenderedFeatures.mockReturnValueOnce([
      {
        id: 'feature-cylinder-fallback',
        layer: { id: 'cylinder-installs-fallback-layer' },
        properties: {},
      },
    ]);

    simulatePointerTap(getMapTouchSurface());

    expect(screen.getByTestId('overlay-marker-details-modal')).toBeInTheDocument();
    expect(screen.getByTestId('overlay-marker-pressure')).toHaveTextContent('N/A');
    expect(screen.getByTestId('overlay-marker-gas-mix')).toHaveTextContent('N/A');
    expect(screen.getByTestId('overlay-marker-install-date')).toHaveTextContent('N/A');
  });

  it('does not open marker details modal for non-interactive map layers', async () => {
    mockProjects = [makeProject({ id: 'p1', name: 'Non Interactive Layer Project' })];
    mockGetProjectGeoJSON.mockResolvedValue(lineFeatureCollection());

    renderDashboard();

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="project-p1-line"]')).not.toBeNull();
    });

    mockQueryRenderedFeatures.mockReturnValueOnce([
      {
        layer: { id: 'project-p1-line' },
        properties: { section_name: 'Main line' },
      },
    ]);

    simulatePointerTap(getMapTouchSurface());

    expect(screen.queryByTestId('overlay-marker-details-modal')).not.toBeInTheDocument();
  });

  it('dismisses marker details modal and updates content when selecting a different marker type', async () => {
    mockProjects = [makeProject({ id: 'p1', name: 'Switch Marker Project' })];
    mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());
    mockGetOverlayGeoJSON.mockImplementation(async (overlayId: string) => {
      if (overlayId === 'explorationLeads') {
        return overlayPointFeatureCollection({ project: 'p1' });
      }
      if (overlayId === 'cylinderInstalls') {
        return overlayPointFeatureCollection({ project_id: 'p1' });
      }
      return null;
    });

    renderDashboard();

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="exploration-leads-icon-layer"]')).not.toBeNull();
      expect(document.querySelector('[data-layer-id="cylinder-installs-icon-layer"]')).not.toBeNull();
    });

    mockQueryRenderedFeatures
      .mockReturnValueOnce([
        {
          layer: { id: 'exploration-leads-icon-layer' },
          properties: { description: 'first marker detail' },
        },
      ])
      .mockReturnValueOnce([
        {
          layer: { id: 'cylinder-installs-icon-layer' },
          properties: {
            pressure: 220,
            pressure_unit_system: 'metric',
            o2_percentage: 21,
            he_percentage: 0,
            install_date: '2026-02-18',
          },
        },
      ]);

    simulatePointerTap(getMapTouchSurface());
    expect(screen.getByTestId('overlay-marker-description')).toHaveTextContent('first marker detail');

    simulatePointerTap(getMapTouchSurface());
    expect(screen.queryByTestId('overlay-marker-description')).not.toBeInTheDocument();
    expect(screen.getByTestId('overlay-marker-pressure')).toHaveTextContent('220 BAR');
    expect(screen.getByTestId('overlay-marker-gas-mix')).toHaveTextContent('Air');

    await userEvent.click(screen.getByText('Close'));
    expect(screen.queryByTestId('overlay-marker-details-modal')).not.toBeInTheDocument();
  });

  it('opens marker details modal when tapping a landmark marker', async () => {
    mockProjects = [makeProject({ id: 'p1', name: 'Landmark Tap Project' })];
    mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());
    mockGetOverlayGeoJSON.mockImplementation(async (overlayId: string) => {
      if (overlayId === 'landmarks') {
        return overlayPointFeatureCollection({ id: 'lm-1', name: 'Big Entrance', description: 'Main entrance' });
      }
      return null;
    });

    renderDashboard();

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="landmarks-layer"]')).not.toBeNull();
    });

    mockQueryRenderedFeatures.mockReturnValueOnce([
      {
        layer: { id: 'landmarks-layer' },
        properties: {
          id: 'lm-1',
          name: 'Big Entrance',
          description: 'Main entrance',
          collection_name: 'Shared Survey',
          is_personal_collection: false,
        },
        geometry: { type: 'Point', coordinates: [2.3, 46.6] },
      },
    ]);

    simulatePointerTap(getMapTouchSurface());

    expect(screen.getByTestId('overlay-marker-details-modal')).toBeInTheDocument();
    expect(screen.getByTestId('overlay-marker-name')).toHaveTextContent('Big Entrance');
    expect(screen.getByTestId('overlay-marker-description')).toHaveTextContent('Main entrance');
    expect(screen.getByTestId('overlay-marker-collection')).toHaveTextContent('Shared Survey');
    expect(screen.getByTestId('overlay-marker-gps')).toHaveTextContent('46.6, 2.3');
  });

  it('colors landmark markers by their collection color', async () => {
    mockProjects = [makeProject({ id: 'p1', name: 'Landmark Color Project' })];
    mockGetOverlayGeoJSON.mockImplementation(async (overlayId: string) => {
      if (overlayId === 'landmarks') return overlayPointFeatureCollection();
      return null;
    });

    renderDashboard();

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="landmarks-layer"]')).not.toBeNull();
    });

    const layer = document.querySelector('[data-layer-id="landmarks-layer"]');
    const expression = JSON.parse(
      layer?.getAttribute('data-layer-text-color-expression') ?? 'null',
    );
    // Collection-driven color (mirrors the web map viewer), not a hardcoded hex.
    expect(layer?.getAttribute('data-layer-text-color')).toBe('');
    expect(expression).toEqual(['coalesce', ['get', 'collection_color'], '#94a3b8']);
  });

  it('flies to a landmark from the panel without opening the details modal', async () => {
    mockMapFlyTo.mockClear();
    mockProjects = [makeProject({ id: 'p1', name: 'Landmark Locate Project' })];
    mockGetOverlayGeoJSON.mockImplementation(async (overlayId: string) => {
      if (overlayId === 'landmarks') {
        return overlayPointFeatureCollection({ id: 'lm-1', name: 'Big Entrance' });
      }
      return null;
    });

    renderDashboard();

    const row = await screen.findByTestId('landmark-row-lm-1');
    await userEvent.click(row);

    expect(mockMapFlyTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [2.3, 46.6] }),
    );
    expect(screen.queryByTestId('overlay-marker-details-modal')).not.toBeInTheDocument();
  });

  it('opens marker details modal when tapping a surface station marker', async () => {
    mockProjects = [makeProject({ id: 'p1', name: 'Surface Tap Project' })];
    mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());
    mockGetOverlayGeoJSON.mockImplementation(async (overlayId: string) => {
      if (overlayId === 'surfaceStations') {
        return overlayPointFeatureCollection({ id: 'ss-1', name: 'Station Alpha', description: 'Weather station' });
      }
      return null;
    });

    renderDashboard();

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="surface-stations-layer"]')).not.toBeNull();
    });

    mockQueryRenderedFeatures.mockReturnValueOnce([
      {
        layer: { id: 'surface-stations-layer' },
        properties: { id: 'ss-1', name: 'Station Alpha', description: 'Weather station' },
        geometry: { type: 'Point', coordinates: [5.1, 43.2] },
      },
    ]);

    simulatePointerTap(getMapTouchSurface());

    expect(screen.getByTestId('overlay-marker-details-modal')).toBeInTheDocument();
    expect(screen.getByTestId('overlay-marker-name')).toHaveTextContent('Station Alpha');
    expect(screen.getByTestId('overlay-marker-description')).toHaveTextContent('Weather station');
    expect(screen.getByTestId('overlay-marker-gps')).toHaveTextContent('43.2, 5.1');
  });

  it('opens marker details modal when tapping a subsurface station circle marker', async () => {
    mockProjects = [makeProject({ id: 'p1', name: 'Subsurface Tap Project' })];
    mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());
    mockGetOverlayGeoJSON.mockImplementation(async (overlayId: string) => {
      if (overlayId === 'subsurfaceStations') {
        return overlayPointFeatureCollection({
          id: 'sub-1', name: 'Sensor Room', description: 'CO2 sensor', tag: 'Geology', project: 'p1',
        });
      }
      return null;
    });

    renderDashboard();

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="subsurface-stations-circles"]')).not.toBeNull();
    });

    mockQueryRenderedFeatures.mockReturnValueOnce([
      {
        layer: { id: 'subsurface-stations-circles' },
        properties: { id: 'sub-1', name: 'Sensor Room', description: 'CO2 sensor', tag: 'Geology' },
      },
    ]);

    simulatePointerTap(getMapTouchSurface());

    expect(screen.getByTestId('overlay-marker-details-modal')).toBeInTheDocument();
    expect(screen.getByTestId('overlay-marker-name')).toHaveTextContent('Sensor Room');
    expect(screen.getByTestId('overlay-marker-description')).toHaveTextContent('CO2 sensor');
    expect(screen.getByTestId('overlay-marker-tag')).toHaveTextContent('Geology');
  });

  it('opens marker details modal when tapping a subsurface station icon marker', async () => {
    mockProjects = [makeProject({ id: 'p1', name: 'Subsurface Icon Project' })];
    mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());
    mockGetOverlayGeoJSON.mockImplementation(async (overlayId: string) => {
      if (overlayId === 'subsurfaceStations') {
        return overlayPointFeatureCollection({
          id: 'sub-2', name: 'Fossil Site', description: 'Ancient bones', type: 'bone', project: 'p1',
        });
      }
      return null;
    });

    renderDashboard();

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="subsurface-stations-bone-icons"]')).not.toBeNull();
    });

    mockQueryRenderedFeatures.mockReturnValueOnce([
      {
        layer: { id: 'subsurface-stations-bone-icons' },
        properties: { id: 'sub-2', name: 'Fossil Site', description: 'Ancient bones' },
      },
    ]);

    simulatePointerTap(getMapTouchSurface());

    expect(screen.getByTestId('overlay-marker-details-modal')).toBeInTheDocument();
    expect(screen.getByTestId('overlay-marker-name')).toHaveTextContent('Fossil Site');
    expect(screen.getByTestId('overlay-marker-description')).toHaveTextContent('Ancient bones');
  });

  it('opens marker details modal when tapping a project star point', async () => {
    mockProjects = [makeProject({ id: 'p1', name: 'Cave Alpha' })];
    mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection(2.3, 46.6));

    renderDashboard();

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="project-p1-point"]')).not.toBeNull();
    });

    mockQueryRenderedFeatures.mockReturnValueOnce([
      {
        layer: { id: 'project-p1-point' },
        properties: { name: 'Entrance A' },
        geometry: { type: 'Point', coordinates: [2.3, 46.6] },
      },
    ]);

    simulatePointerTap(getMapTouchSurface());

    expect(screen.getByTestId('overlay-marker-details-modal')).toBeInTheDocument();
    expect(screen.getByTestId('overlay-marker-project-name')).toHaveTextContent('Cave Alpha');
    expect(screen.getByTestId('overlay-marker-name')).toHaveTextContent('Entrance A');
    expect(screen.getByTestId('overlay-marker-gps')).toHaveTextContent('46.6, 2.3');
  });

  it('renders fallback values for landmark with missing properties', async () => {
    mockProjects = [makeProject({ id: 'p1', name: 'Fallback Landmark Project' })];
    mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());
    mockGetOverlayGeoJSON.mockImplementation(async (overlayId: string) => {
      if (overlayId === 'landmarks') {
        return overlayPointFeatureCollection({});
      }
      return null;
    });

    renderDashboard();

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="landmarks-layer"]')).not.toBeNull();
    });

    mockQueryRenderedFeatures.mockReturnValueOnce([
      {
        layer: { id: 'landmarks-layer' },
        properties: {},
      },
    ]);

    simulatePointerTap(getMapTouchSurface());

    expect(screen.getByTestId('overlay-marker-details-modal')).toBeInTheDocument();
    expect(screen.getByTestId('overlay-marker-name')).toHaveTextContent('N/A');
    expect(screen.getByTestId('overlay-marker-description')).toHaveTextContent('N/A');
    expect(screen.getByTestId('overlay-marker-gps')).toHaveTextContent('N/A');
  });

  it('does not open GPS modal before long press duration completes', async () => {
    try {
      mockProjects = [makeProject({ id: 'p1', name: 'Long Press Boundary Project' })];
      mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());

      renderDashboard();

      await waitFor(() => {
        expect(document.querySelector('.dashboard-map-touch-surface')).not.toBeNull();
      });

      const surface = getMapTouchSurface();

      // Fake timers ONLY for the synchronous long-press window (see note above).
      await settleAsyncEffects();
      vi.useFakeTimers();
      fireEvent.pointerDown(surface, {
        pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 80,
      });

      act(() => { vi.advanceTimersByTime(MAP.LONG_PRESS_DURATION_MS - 1); });

      expect(screen.queryByTestId('overlay-marker-details-modal')).not.toBeInTheDocument();
      expect(mockMapUnproject).not.toHaveBeenCalled();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('opens GPS coordinate modal after long press on the map', async () => {
    try {
      mockProjects = [makeProject({ id: 'p1', name: 'Long Press Project' })];
      mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());

      renderDashboard();

      await waitFor(() => {
        expect(document.querySelector('.dashboard-map-touch-surface')).not.toBeNull();
      });

      const surface = getMapTouchSurface();

      // Fake timers ONLY for the synchronous long-press window (see note above).
      await settleAsyncEffects();
      vi.useFakeTimers();
      fireEvent.pointerDown(surface, {
        pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 80,
      });

      act(() => { vi.advanceTimersByTime(MAP.LONG_PRESS_DURATION_MS); });

      expect(screen.getByTestId('overlay-marker-details-modal')).toBeInTheDocument();
      expect(screen.getByTestId('overlay-marker-gps')).toBeInTheDocument();
      expect(mockQueryRenderedFeatures).toHaveBeenCalledWith(
        [
          [120 - MAP.LONG_PRESS_EMPTY_SPOT_RADIUS_PX, 80 - MAP.LONG_PRESS_EMPTY_SPOT_RADIUS_PX],
          [120 + MAP.LONG_PRESS_EMPTY_SPOT_RADIUS_PX, 80 + MAP.LONG_PRESS_EMPTY_SPOT_RADIUS_PX],
        ],
        expect.objectContaining({ layers: expect.any(Array) }),
      );
      expect(mockMapUnproject).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not open GPS modal when long press is below minimum zoom', async () => {
    try {
      mockMapGetZoom.mockReturnValue(MAP.MARKER_INTERACTION_MIN_ZOOM - 1);
      mockProjects = [makeProject({ id: 'p1', name: 'Low Zoom Long Press Project' })];
      mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());

      renderDashboard();

      await waitFor(() => {
        expect(document.querySelector('.dashboard-map-touch-surface')).not.toBeNull();
      });

      const surface = getMapTouchSurface();
      // Fake timers ONLY for the synchronous long-press window (see note above).
      await settleAsyncEffects();
      vi.useFakeTimers();
      fireEvent.pointerDown(surface, {
        pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 80,
      });

      act(() => { vi.advanceTimersByTime(MAP.LONG_PRESS_DURATION_MS); });

      expect(screen.queryByTestId('overlay-marker-details-modal')).not.toBeInTheDocument();
      expect(mockQueryRenderedFeatures).not.toHaveBeenCalled();
      expect(mockMapUnproject).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows a long press on survey line geometry', async () => {
    try {
      mockProjects = [makeProject({ id: 'p1', name: 'Line Hit Long Press Project' })];
      mockGetProjectGeoJSON.mockResolvedValue(lineFeatureCollection());

      renderDashboard();

      await waitFor(() => {
        expect(document.querySelector('[data-layer-id="project-p1-line"]')).not.toBeNull();
      });

      const queryWithLineHit = ((...args: unknown[]): MockRenderedFeature[] => {
        const options = args[1] as { layers?: string[] } | undefined;
        return options?.layers?.includes('project-p1-line')
          ? [
              {
                layer: { id: 'project-p1-line' },
                properties: { section_name: 'Main line' },
              },
            ]
          : [];
      }) as () => MockRenderedFeature[];
      mockQueryRenderedFeatures.mockImplementation(queryWithLineHit);

      const surface = getMapTouchSurface();
      // Fake timers ONLY for the synchronous long-press window (see note above).
      await settleAsyncEffects();
      vi.useFakeTimers();
      fireEvent.pointerDown(surface, {
        pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 80,
      });

      act(() => { vi.advanceTimersByTime(MAP.LONG_PRESS_RING_REVEAL_DELAY_MS); });
      expect(screen.getByTestId('long-press-ring')).toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(MAP.LONG_PRESS_DURATION_MS); });

      expect(screen.getByTestId('overlay-marker-details-modal')).toBeInTheDocument();
      expect(mockMapUnproject).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows a long press on the GPS location dot', async () => {
    try {
      renderDashboard();
      await waitFor(() => {
        expect(document.querySelector('.dashboard-map-touch-surface')).not.toBeNull();
      });
      const queryWithLocationDot = ((...args: unknown[]): MockRenderedFeature[] => {
        const options = args[1] as { layers?: string[] } | undefined;
        return options?.layers?.includes('user-location-dot')
          ? [
              {
                layer: { id: 'user-location-dot' },
                properties: {},
              },
            ]
          : [];
      }) as () => MockRenderedFeature[];
      mockQueryRenderedFeatures.mockImplementation(queryWithLocationDot);

      const surface = getMapTouchSurface();
      // Fake timers ONLY for the synchronous long-press window (see note above).
      await settleAsyncEffects();
      vi.useFakeTimers();
      fireEvent.pointerDown(surface, {
        pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 80,
      });

      act(() => { vi.advanceTimersByTime(MAP.LONG_PRESS_RING_REVEAL_DELAY_MS); });
      expect(screen.getByTestId('long-press-ring')).toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(MAP.LONG_PRESS_DURATION_MS); });

      expect(screen.getByTestId('overlay-marker-details-modal')).toBeInTheDocument();
      expect(mockMapUnproject).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not open GPS modal if finger moves before long press completes', async () => {
    try {
      mockProjects = [makeProject({ id: 'p1', name: 'Long Press Move Project' })];
      mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());

      renderDashboard();

      await waitFor(() => {
        expect(document.querySelector('.dashboard-map-touch-surface')).not.toBeNull();
      });

      const surface = getMapTouchSurface();

      // Fake timers ONLY for the synchronous long-press window (see note above).
      // The await inside is a microtask flush, so no real time is needed.
      await settleAsyncEffects();
      vi.useFakeTimers();
      await act(async () => {
        fireEvent.pointerDown(surface, {
          pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 80,
        });
        fireEvent.pointerMove(surface, {
          pointerId: 1, pointerType: 'touch', clientX: 170, clientY: 80,
        });
        vi.advanceTimersByTime(MAP.LONG_PRESS_DURATION_MS);
        await Promise.resolve();
      });

      expect(screen.queryByTestId('overlay-marker-details-modal')).not.toBeInTheDocument();
      expect(mockMapUnproject).not.toHaveBeenCalled();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('does not open GPS modal if pointer is released before long press completes', async () => {
    try {
      mockProjects = [makeProject({ id: 'p1', name: 'Long Press Release Project' })];
      mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());

      renderDashboard();

      await waitFor(() => {
        expect(document.querySelector('.dashboard-map-touch-surface')).not.toBeNull();
      });
      await waitFor(() => {
        expect(document.querySelector('[data-layer-id="project-p1-point"]')).not.toBeNull();
      });
      await act(async () => {});

      const surface = getMapTouchSurface();

      // Fake timers ONLY for the synchronous long-press window (see note above).
      await settleAsyncEffects();
      vi.useFakeTimers();
      act(() => {
        fireEvent.pointerDown(surface, {
          pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 80,
        });
        fireEvent.pointerUp(surface, {
          pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 80,
        });
        vi.advanceTimersByTime(MAP.LONG_PRESS_DURATION_MS);
      });

      expect(mockMapUnproject).not.toHaveBeenCalled();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('does not open GPS modal when second touch arrives (multi-touch)', async () => {
    try {
      mockProjects = [makeProject({ id: 'p1', name: 'Multi Touch Project' })];
      mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());

      renderDashboard();

      await waitFor(() => {
        expect(document.querySelector('.dashboard-map-touch-surface')).not.toBeNull();
      });

      const surface = getMapTouchSurface();

      // Fake timers ONLY for the synchronous long-press window (see note above).
      await settleAsyncEffects();
      vi.useFakeTimers();
      fireEvent.pointerDown(surface, {
        pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 80,
      });

      fireEvent.pointerDown(surface, {
        pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 80,
      });

      act(() => { vi.advanceTimersByTime(MAP.LONG_PRESS_DURATION_MS); });

      expect(screen.queryByTestId('overlay-marker-details-modal')).not.toBeInTheDocument();
      expect(mockMapUnproject).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides project-linked overlays when a project is hidden and keeps global overlays visible', async () => {
    mockProjects = [
      makeProject({ id: 'p1', name: 'Alpha' }),
      makeProject({ id: 'p2', name: 'Beta' }),
    ];
    mockGetProjectGeoJSON.mockImplementation(async (projectId: string) =>
      pointFeatureCollection(projectId === 'p1' ? 2.3 : 2.4, 46.6),
    );
    mockGetOverlayGeoJSON.mockImplementation(async (overlayId: string) => {
      if (overlayId === 'landmarks') return overlayPointFeatureCollection({ name: 'Landmark A' });
      if (overlayId === 'surfaceStations') return overlayPointFeatureCollection({ name: 'Surface A' });
      if (overlayId === 'subsurfaceStations') {
        return overlayPointFeatureCollection({ type: 'sensor', project: 'p1' });
      }
      if (overlayId === 'explorationLeads') {
        return overlayPointFeatureCollection({ project: 'p1' });
      }
      if (overlayId === 'cylinderInstalls') {
        return overlayPointFeatureCollection({ project_id: 'p1' });
      }
      return null;
    });

    renderDashboard();

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="landmarks-layer"]')).not.toBeNull();
      expect(document.querySelector('[data-layer-id="surface-stations-layer"]')).not.toBeNull();
      expect(document.querySelector('[data-layer-id="subsurface-stations-circles"]')).not.toBeNull();
      expect(document.querySelector('[data-layer-id="exploration-leads-icon-layer"]')).not.toBeNull();
      expect(document.querySelector('[data-layer-id="cylinder-installs-icon-layer"]')).not.toBeNull();
    });

    await userEvent.click(screen.getByLabelText('Toggle Alpha'));

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="subsurface-stations-circles"]')).toBeNull();
      expect(document.querySelector('[data-layer-id="exploration-leads-icon-layer"]')).toBeNull();
      expect(document.querySelector('[data-layer-id="exploration-leads-fallback-layer"]')).toBeNull();
      expect(document.querySelector('[data-layer-id="cylinder-installs-icon-layer"]')).toBeNull();
      expect(document.querySelector('[data-layer-id="cylinder-installs-fallback-layer"]')).toBeNull();
      expect(document.querySelector('[data-layer-id="landmarks-layer"]')).not.toBeNull();
      expect(document.querySelector('[data-layer-id="surface-stations-layer"]')).not.toBeNull();
    });
  });

  it('restores visibility from saved preferences on first load', async () => {
    mockProjects = [
      makeProject({ id: 'p1', name: 'Alpha' }),
      makeProject({ id: 'p2', name: 'Beta' }),
    ];
    mockGetProjectGeoJSON.mockImplementation(async (projectId: string) =>
      pointFeatureCollection(projectId === 'p1' ? 2.3 : 2.4, 46.6),
    );
    mockGetProjectVisibilityPreferences.mockReturnValue({
      p1: false,
      p2: true,
    });

    renderDashboard();

    await waitFor(() => {
      expect(document.querySelectorAll('[data-layer-id$="-line"]')).toHaveLength(1);
    });
  });

  it('persists project visibility when toggled', async () => {
    mockProjects = [makeProject({ id: 'p1', name: 'Toggle Me' })];
    mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByLabelText('Toggle Toggle Me')).toBeInTheDocument();
      expect(document.querySelector('[data-layer-id="project-p1-line"]')).not.toBeNull();
    });

    await userEvent.click(screen.getByLabelText('Toggle Toggle Me'));
    expect(mockSetProjectVisibilityPreference).toHaveBeenCalledWith('p1', false);
  });

  it('persists show-all and hide-all visibility in bulk', async () => {
    mockProjects = [
      makeProject({ id: 'p1', name: 'Alpha' }),
      makeProject({ id: 'p2', name: 'Beta' }),
    ];
    mockGetProjectGeoJSON.mockImplementation(async (projectId: string) =>
      pointFeatureCollection(projectId === 'p1' ? 2.3 : 2.4, 46.6),
    );
    mockGetProjectVisibilityPreferences.mockReturnValue({
      p1: false,
      p2: false,
    });

    renderDashboard();

    const projectPanel = () => within(screen.getByTestId('project-panel'));
    await waitFor(() => {
      expect(projectPanel().getByText('Show all')).toBeInTheDocument();
    });

    await userEvent.click(projectPanel().getByText('Show all'));
    expect(mockSetProjectVisibilityPreferences).toHaveBeenCalledWith({
      p1: true,
      p2: true,
    });

    await userEvent.click(projectPanel().getByText('Hide all'));
    expect(mockSetProjectVisibilityPreferences).toHaveBeenCalledWith({
      p1: false,
      p2: false,
    });
  });

  it('persists visible=true when zooming to a project', async () => {
    mockProjects = [makeProject({ id: 'p1', name: 'Zoom Me' })];
    mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());
    mockGetProjectVisibilityPreferences.mockReturnValue({
      p1: false,
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Zoom Me')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Zoom Me'));
    expect(mockSetProjectVisibilityPreference).toHaveBeenCalledWith('p1', true);
  });

  describe('country gate', () => {
    it('hides project layers for a country whose gate is OFF without mutating per-project prefs', async () => {
      mockProjects = [
        makeProject({ id: 'p1', name: 'Alpha', country: 'FR' }),
        makeProject({ id: 'p2', name: 'Bravo', country: 'US' }),
      ];
      mockGetProjectGeoJSON.mockImplementation(async (projectId: string) =>
        pointFeatureCollection(projectId === 'p1' ? 2.3 : -100, 46.6),
      );
      mockGetCountryVisibilityPreferences.mockReturnValue({ FR: false });

      renderDashboard();

      await waitFor(() => {
        expect(document.querySelector('[data-layer-id="project-p2-line"]')).not.toBeNull();
      });

      expect(document.querySelector('[data-layer-id="project-p1-line"]')).toBeNull();
      expect(mockSetProjectVisibilityPreference).not.toHaveBeenCalled();
    });

    it('drops project-linked overlay features when the project country gate is OFF', async () => {
      mockProjects = [makeProject({ id: 'p1', name: 'Alpha', country: 'FR' })];
      mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());
      mockGetOverlayGeoJSON.mockImplementation(async (overlayId: string) => {
        if (overlayId === 'subsurfaceStations') {
          return overlayPointFeatureCollection({ project: 'p1' });
        }
        return null;
      });
      mockGetCountryVisibilityPreferences.mockReturnValue({ FR: false });

      renderDashboard();

      await waitFor(() => {
        expect(mockGetOverlayGeoJSON).toHaveBeenCalledWith('subsurfaceStations');
      });

      // Project is gated OFF -> the linked station feature is filtered out
      // and the source/layer never mounts.
      expect(document.querySelector('[data-layer-id="subsurface-stations-circles"]')).toBeNull();
    });

    it('recomputes the depth domain when a country gate is OFF', async () => {
      mockProjects = [
        makeProject({ id: 'p1', name: 'Shallow Cave', country: 'FR' }),
        makeProject({ id: 'p2', name: 'Deep Cave', country: 'US' }),
      ];
      mockGetProjectGeoJSON.mockImplementation(async (projectId: string) => {
        if (projectId === 'p1') return depthFeatureCollection(25);
        if (projectId === 'p2') return depthFeatureCollection(80);
        return null;
      });
      mockGetCountryVisibilityPreferences.mockReturnValue({ US: false });

      renderDashboard({ colorMode: 'depth' });

      await waitFor(() => {
        expect(document.querySelector('[data-layer-id="project-p1-line"]')).not.toBeNull();
        expect(screen.getByTestId('depth-gauge')).toBeInTheDocument();
      });

      expect(document.querySelector('[data-layer-id="project-p2-line"]')).toBeNull();
      expect(screen.getByTestId('depth-gauge-max')).toHaveTextContent('25 ft');
    });

    it('persists country visibility when the country toggle is changed', async () => {
      mockProjects = [makeProject({ id: 'p1', name: 'Alpha', country: 'FR' })];
      mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('projects-tab')).toBeInTheDocument();
      });
      await userEvent.click(screen.getByTestId('projects-tab'));

      await waitFor(() => {
        expect(screen.getByTestId('country-toggle-FR')).toBeInTheDocument();
      });

      const countryToggleInput = screen
        .getByTestId('country-toggle-FR')
        .querySelector('input') as HTMLInputElement;
      await userEvent.click(countryToggleInput);

      expect(mockSetCountryVisibilityPreference).toHaveBeenCalledWith('FR', false);

      await waitFor(() => {
        expect(document.querySelector('[data-layer-id="project-p1-line"]')).toBeNull();
      });
    });

    it('preserves country gate ON when the user keeps individual toggle OFF', async () => {
      mockProjects = [
        makeProject({ id: 'p1', name: 'Alpha', country: 'FR' }),
        makeProject({ id: 'p2', name: 'Bravo', country: 'FR' }),
      ];
      mockGetProjectGeoJSON.mockImplementation(async (projectId: string) =>
        pointFeatureCollection(projectId === 'p1' ? 2.3 : 2.4, 46.6),
      );
      mockGetProjectVisibilityPreferences.mockReturnValue({ p1: true, p2: false });
      // FR gate already ON (default).

      renderDashboard();

      await waitFor(() => {
        expect(document.querySelector('[data-layer-id="project-p1-line"]')).not.toBeNull();
      });

      expect(document.querySelector('[data-layer-id="project-p2-line"]')).toBeNull();
    });

    it('persists country collapse state when the country header is tapped', async () => {
      mockProjects = [makeProject({ id: 'p1', name: 'Alpha', country: 'FR' })];
      mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('projects-tab')).toBeInTheDocument();
      });
      await userEvent.click(screen.getByTestId('projects-tab'));

      await waitFor(() => {
        expect(screen.getByTestId('country-collapse-FR')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByTestId('country-collapse-FR'));
      expect(mockSetCountryCollapsedPreference).toHaveBeenCalledWith('FR', true);
    });

    it('Show all enables both individual prefs and country gates', async () => {
      mockProjects = [
        makeProject({ id: 'p1', name: 'Alpha', country: 'FR' }),
        makeProject({ id: 'p2', name: 'Bravo', country: 'US' }),
      ];
      mockGetProjectGeoJSON.mockImplementation(async (projectId: string) =>
        pointFeatureCollection(projectId === 'p1' ? 2.3 : -100, 46.6),
      );
      mockGetProjectVisibilityPreferences.mockReturnValue({ p1: false, p2: false });
      mockGetCountryVisibilityPreferences.mockReturnValue({ FR: false });

      renderDashboard();

      const projectPanel = () => within(screen.getByTestId('project-panel'));
      await waitFor(() => {
        expect(projectPanel().getByText('Show all')).toBeInTheDocument();
      });

      await userEvent.click(projectPanel().getByText('Show all'));

      expect(mockSetProjectVisibilityPreferences).toHaveBeenCalledWith({
        p1: true,
        p2: true,
      });
      expect(mockSetCountryVisibilityPreferences).toHaveBeenCalledWith({
        FR: true,
        US: true,
      });
    });

    it('Hide all only flips individual prefs and leaves country gates untouched', async () => {
      mockProjects = [
        makeProject({ id: 'p1', name: 'Alpha', country: 'FR' }),
        makeProject({ id: 'p2', name: 'Bravo', country: 'US' }),
      ];
      mockGetProjectGeoJSON.mockImplementation(async (projectId: string) =>
        pointFeatureCollection(projectId === 'p1' ? 2.3 : -100, 46.6),
      );

      renderDashboard();

      const projectPanel = () => within(screen.getByTestId('project-panel'));
      await waitFor(() => {
        expect(projectPanel().getByText('Hide all')).toBeInTheDocument();
      });

      await userEvent.click(projectPanel().getByText('Hide all'));

      expect(mockSetProjectVisibilityPreferences).toHaveBeenCalledWith({
        p1: false,
        p2: false,
      });
      expect(mockSetCountryVisibilityPreferences).not.toHaveBeenCalled();
    });

    it('restores country visibility and collapse state on first render', async () => {
      mockProjects = [makeProject({ id: 'p1', name: 'Alpha', country: 'FR' })];
      mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());
      mockGetCountryVisibilityPreferences.mockReturnValue({ FR: false });
      mockGetCountryCollapsedPreferences.mockReturnValue({ FR: true });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('projects-tab')).toBeInTheDocument();
      });
      await userEvent.click(screen.getByTestId('projects-tab'));

      await waitFor(() => {
        expect(screen.getByTestId('country-toggle-FR')).toBeInTheDocument();
      });

      const toggleInput = screen
        .getByTestId('country-toggle-FR')
        .querySelector('input') as HTMLInputElement;
      expect(toggleInput.checked).toBe(false);
      // Collapsed -> the project row is not rendered.
      expect(screen.queryByText('Alpha')).toBeNull();
    });

    it('zoom-to-project re-enables the country gate when it is OFF for the target project', async () => {
      mockProjects = [makeProject({ id: 'p1', name: 'Alpha', country: 'FR' })];
      mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());
      mockGetCountryVisibilityPreferences.mockReturnValue({ FR: false });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByTestId('projects-tab')).toBeInTheDocument();
      });
      await userEvent.click(screen.getByTestId('projects-tab'));

      await waitFor(() => {
        expect(screen.getByText('Alpha')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText('Alpha'));

      expect(mockSetCountryVisibilityPreference).toHaveBeenCalledWith('FR', true);
      expect(mockSetProjectVisibilityPreference).toHaveBeenCalledWith('p1', true);
    });
  });

  it('closes the project panel after zooming to a project', async () => {
    mockProjects = [makeProject({ id: 'p1', name: 'Click Me' })];
    mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());
    mockGetProjectVisibilityPreferences.mockReturnValue({ p1: true });

    renderDashboard();

    // Open the panel first
    await waitFor(() => {
      expect(screen.getByTestId('projects-tab')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('projects-tab'));

    // Panel should be visible (translate-x-0)
    const panelBefore = document.querySelector('.translate-x-0.z-30');
    expect(panelBefore).not.toBeNull();

    // Click the project name to zoom
    await userEvent.click(screen.getByText('Click Me'));

    // Panel should now be closed (-translate-x-full)
    await waitFor(() => {
      const panelAfter = document.querySelector('.-translate-x-full.z-30');
      expect(panelAfter).not.toBeNull();
    });
  });

  it('never exposes a project whose validated map data is unavailable', async () => {
    mockProjects = [makeProject({ id: 'quarantined', name: 'Faulty Cave' })];
    mockGetProjectGeoJSON.mockResolvedValue(null);

    renderDashboard();
    await waitFor(() => expect(mockGetProjectMapData).toHaveBeenCalledWith('quarantined'));
    await userEvent.click(screen.getByTestId('projects-tab'));

    expect(screen.queryByText('Faulty Cave')).not.toBeInTheDocument();
    expect(document.querySelector('[data-layer-id="project-quarantined-line"]')).toBeNull();
    expect(mockMapFitBounds).not.toHaveBeenCalled();
  });

  it('hides a stale commit immediately and installs the superseding map record atomically', async () => {
    const first = makeProject({ id: 'p1', name: 'Commit Cave' });
    const second = makeProject({
      id: 'p1',
      name: 'Commit Cave',
      latest_commit: { ...first.latest_commit, id: 'c2' },
    });
    mockProjects = [first];
    mockGetProjectVisibilityPreferences.mockReturnValue({ p1: true });
    mockGetProjectMapData.mockResolvedValue({
      commitId: 'c1',
      featureCollection: pointFeatureCollection(),
      bounds: measureProjectGeoJSONBounds(pointFeatureCollection()).bounds,
    });

    const view = renderDashboard();
    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="project-p1-line"]')).not.toBeNull();
    });

    mockProjects = [second];
    mockMapDataRevision += 1;
    mockGetProjectMapData.mockResolvedValue({
      commitId: 'c2',
      featureCollection: pointFeatureCollection(3, 47),
      bounds: measureProjectGeoJSONBounds(pointFeatureCollection(3, 47)).bounds,
    });
    view.rerenderDashboard();

    expect(document.querySelector('[data-layer-id="project-p1-line"]')).toBeNull();
    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="project-p1-line"]')).not.toBeNull();
    });
    expect(mockGetProjectMapData).toHaveBeenLastCalledWith('p1');
  });

  it('preserves visible user intent while a project is quarantined and restores it on recovery', async () => {
    mockProjects = [makeProject({ id: 'p1', name: 'Recovering Cave' })];
    mockGetProjectVisibilityPreferences.mockReturnValue({ p1: true });
    mockGetProjectMapData.mockResolvedValue({
      commitId: 'c1',
      featureCollection: pointFeatureCollection(),
      bounds: measureProjectGeoJSONBounds(pointFeatureCollection()).bounds,
    });
    const view = renderDashboard();
    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="project-p1-line"]')).not.toBeNull();
    });

    mockGetProjectMapData.mockResolvedValue(null);
    mockMapDataRevision += 1;
    view.rerenderDashboard();
    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="project-p1-line"]')).toBeNull();
    });

    mockGetProjectMapData.mockResolvedValue({
      commitId: 'c1',
      featureCollection: pointFeatureCollection(),
      bounds: measureProjectGeoJSONBounds(pointFeatureCollection()).bounds,
    });
    mockMapDataRevision += 1;
    view.rerenderDashboard();
    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="project-p1-line"]')).not.toBeNull();
    });
    expect(mockSetProjectVisibilityPreference).not.toHaveBeenCalledWith('p1', false);
  });

  it('hides landmark layers when showLandmarks preference is false', async () => {
    mockGetShowLandmarks.mockReturnValue(false);
    mockProjects = [makeProject({ id: 'p1', name: 'Landmark Hidden Project' })];
    mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());
    mockGetOverlayGeoJSON.mockImplementation(async (overlayId: string) => {
      if (overlayId === 'landmarks') return overlayPointFeatureCollection({ name: 'Hidden LM' });
      return null;
    });

    renderDashboard();

    await waitFor(() => {
      expect(mockGetOverlayGeoJSON).toHaveBeenCalledWith('landmarks');
    });

    expect(document.querySelector('[data-layer-id="landmarks-layer"]')).toBeNull();
    expect(document.querySelector('[data-layer-id="landmarks-labels"]')).toBeNull();
  });

  it('uses the same project color in panel dot and map layer', async () => {
    mockProjects = [
      makeProject({
        id: 'p-hidden',
        name: 'Alpha Hidden',
        exclude_geojson: true,
        geojson_file: null,
      }),
      makeProject({
        id: 'p-visible',
        name: 'Beta Visible',
      }),
    ];
    mockGetProjectGeoJSON.mockImplementation(async (projectId: string) => {
      if (projectId === 'p-visible') {
        return pointFeatureCollection(2.4, 46.7);
      }
      return null;
    });

    const history = renderDashboard();
    await waitFor(() => {
      expect(history.location.pathname).toBe('/dashboard');
      expect(mockGetProjectGeoJSON).toHaveBeenCalledWith('p-visible');
      expect(screen.getByTestId('project-color-dot-p-visible')).toBeInTheDocument();
    });

    const lineLayer = document.querySelector(
      '[data-layer-id="project-p-visible-line"]',
    ) as HTMLElement | null;
    expect(lineLayer).not.toBeNull();

    const layerColor = lineLayer?.dataset.layerColor;
    expect(layerColor).toBeTruthy();

    const panelDot = screen.getByTestId('project-color-dot-p-visible');
    // jsdom v28 normalizes inline CSS hex colors to rgb()
    const rgbColor = layerColor!.replace(
      /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i,
      (_, r, g, b) => `rgb(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)})`,
    );
    expect(panelDot.getAttribute('style')).toContain(`border-color: ${rgbColor}`);
  });
});

describe('Dashboard -- My Location button', () => {
  it('renders the my-location button', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('my-location-button')).toBeInTheDocument();
    });
  });

  it('has accessible label', async () => {
    renderDashboard();
    await waitFor(() => {
      const button = screen.getByLabelText('Turn on live location');
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute('aria-pressed', 'false');
    });
  });
});

describe('Dashboard -- Map layer switcher', () => {
  beforeEach(() => {
    mockIsOfflineLocked = false;
    mockSetSelectedMapLayerId.mockReset();
  });

  it('renders the map layer FAB', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('map-layer-button')).toBeInTheDocument();
    });
  });

  it('persists the selected layer when switching', async () => {
    const user = userEvent.setup();
    renderDashboard();

    await user.click(await screen.findByTestId('map-layer-button'));
    await user.click(screen.getByTestId('map-layer-option-esri-world-hillshade'));

    expect(mockSetSelectedMapLayerId).toHaveBeenCalledWith('esri-world-hillshade');
  });

  it('disables un-synced layers while offline-locked', async () => {
    mockIsOfflineLocked = true;
    const user = userEvent.setup();
    renderDashboard({ selectedMapLayerId: 'esri-satellite', layerOfflineSync: {} });

    await user.click(await screen.findByTestId('map-layer-button'));

    expect(screen.getByTestId('map-layer-option-esri-world-hillshade')).toBeDisabled();
    expect(screen.getByTestId('map-layer-option-esri-satellite')).not.toBeDisabled();
  });
});

describe('Dashboard -- User location dot', () => {
  beforeEach(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    vi.clearAllMocks();
    mockGpsRecordingState = 'idle';
    mockController.currentTrackPoints = [];
    locationWatchCallbackRef.current = null;
    appStateCallbackRef.current = null;
    headingCallbackRef.current = null;
    mockRequestPermissions.mockReset().mockResolvedValue({ location: 'granted' });
    mockWatchPosition.mockReset().mockImplementation(
      async (_options: unknown, callback: (position: unknown, error?: unknown) => void) => {
        locationWatchCallbackRef.current = callback;
        return 'live-location-watch';
      },
    );
    mockClearWatch.mockReset().mockResolvedValue(undefined);
    mockStartHeading.mockReset().mockResolvedValue(undefined);
    mockStopHeading.mockReset().mockResolvedValue(undefined);
  });

  it('toggles a continuously watched manual dot and heading cone', async () => {
    renderDashboard();

    const btn = await screen.findByTestId('my-location-button');
    await userEvent.click(btn);

    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Turn off live location')).toBeInTheDocument();
    await waitFor(() => expect(mockWatchPosition).toHaveBeenCalledTimes(1));

    act(() => {
      locationWatchCallbackRef.current?.({
        coords: { latitude: 46.6, longitude: 2.3, accuracy: 10 },
        timestamp: Date.now(),
      });
    });

    await waitFor(() => {
      const layer = document.querySelector('[data-layer-id="user-location-dot"]');
      expect(layer).not.toBeNull();
    });
    expect(mockMapFlyTo).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(mockStartHeading).toHaveBeenCalledTimes(1));
    act(() => headingCallbackRef.current?.({ value: 45 }));
    expect(await screen.findByTestId('user-location-heading-cone')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('my-location-button'));

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="user-location-dot"]')).toBeNull();
      expect(screen.queryByTestId('user-location-heading-cone')).not.toBeInTheDocument();
      expect(screen.getByTestId('my-location-button')).toHaveAttribute('aria-pressed', 'false');
    });
    expect(mockClearWatch).toHaveBeenCalled();
    await waitFor(() => expect(mockStopHeading).toHaveBeenCalledTimes(1));
  });

  it('uses an active recording for the dot and cone without manual mode', async () => {
    mockGpsRecordingState = 'recording';
    mockController.currentTrackPoints = [{
      latitude: 46.61,
      longitude: 2.31,
      accuracy: 8,
      timestamp: Date.now(),
    }];

    renderDashboard();

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="user-location-dot"]')).not.toBeNull();
    });
    expect(document.querySelector('[data-source-id="user-location-source"]'))
      .toHaveAttribute('data-source-data', expect.stringContaining('[2.31,46.61]'));
    expect(mockWatchPosition).not.toHaveBeenCalled();

    await waitFor(() => expect(mockStartHeading).toHaveBeenCalledTimes(1));
    act(() => headingCallbackRef.current?.({ value: 90 }));
    expect(await screen.findByTestId('user-location-heading-cone')).toBeInTheDocument();
  });

  it('retains a paused recording dot without consuming the compass', async () => {
    mockGpsRecordingState = 'paused';
    mockController.currentTrackPoints = [{
      latitude: 46.62,
      longitude: 2.32,
      timestamp: Date.now(),
    }];

    renderDashboard();

    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="user-location-dot"]')).not.toBeNull();
    });
    expect(screen.queryByTestId('user-location-heading-cone')).not.toBeInTheDocument();
    expect(mockStartHeading).not.toHaveBeenCalled();
    expect(mockWatchPosition).not.toHaveBeenCalled();
  });

  it('gives the fresher manual fix priority over a recording and keeps it after pause', async () => {
    mockGpsRecordingState = 'recording';
    mockController.currentTrackPoints = [{
      latitude: 46.63,
      longitude: 2.33,
      timestamp: Date.now(),
    }];
    const view = renderDashboard();
    await waitFor(() => {
      expect(document.querySelector('[data-source-id="user-location-source"]'))
        .toHaveAttribute('data-source-data', expect.stringContaining('[2.33,46.63]'));
    });

    await userEvent.click(await screen.findByTestId('my-location-button'));
    await waitFor(() => expect(mockWatchPosition).toHaveBeenCalledTimes(1));
    act(() => {
      locationWatchCallbackRef.current?.({
        coords: { latitude: 46.64, longitude: 2.34, accuracy: 7 },
        timestamp: Date.now(),
      });
    });
    await waitFor(() => {
      expect(document.querySelector('[data-source-id="user-location-source"]'))
        .toHaveAttribute('data-source-data', expect.stringContaining('[2.34,46.64]'));
    });

    mockGpsRecordingState = 'paused';
    view.rerenderDashboard();

    expect(document.querySelector('[data-source-id="user-location-source"]'))
      .toHaveAttribute('data-source-data', expect.stringContaining('[2.34,46.64]'));
    expect(screen.getByTestId('my-location-button')).toHaveAttribute('aria-pressed', 'true');

    mockGpsRecordingState = 'idle';
    view.rerenderDashboard();
    expect(document.querySelector('[data-source-id="user-location-source"]'))
      .toHaveAttribute('data-source-data', expect.stringContaining('[2.34,46.64]'));
  });

  it('removes and restores only the recording-owned cone across pause/resume/stop', async () => {
    mockGpsRecordingState = 'recording';
    mockController.currentTrackPoints = [{
      latitude: 46.67,
      longitude: 2.37,
      timestamp: Date.now(),
    }];
    const view = renderDashboard();
    await waitFor(() => expect(mockStartHeading).toHaveBeenCalledTimes(1));
    act(() => headingCallbackRef.current?.({ value: 180 }));
    expect(await screen.findByTestId('user-location-heading-cone')).toBeInTheDocument();

    mockGpsRecordingState = 'paused';
    view.rerenderDashboard();
    await waitFor(() => expect(mockStopHeading).toHaveBeenCalledTimes(1));
    expect(document.querySelector('[data-layer-id="user-location-dot"]')).not.toBeNull();
    expect(screen.queryByTestId('user-location-heading-cone')).not.toBeInTheDocument();

    mockGpsRecordingState = 'recording';
    view.rerenderDashboard();
    await waitFor(() => expect(mockStartHeading).toHaveBeenCalledTimes(2));
    act(() => headingCallbackRef.current?.({ value: 181 }));
    expect(await screen.findByTestId('user-location-heading-cone')).toBeInTheDocument();

    mockGpsRecordingState = 'idle';
    view.rerenderDashboard();
    await waitFor(() => expect(mockStopHeading).toHaveBeenCalledTimes(2));
    expect(document.querySelector('[data-layer-id="user-location-dot"]')).toBeNull();
    expect(screen.queryByTestId('user-location-heading-cone')).not.toBeInTheDocument();
  });

  it('suspends native location and heading while the route or app is inactive', async () => {
    const view = renderDashboard();
    await userEvent.click(await screen.findByTestId('my-location-button'));
    await waitFor(() => expect(mockWatchPosition).toHaveBeenCalledTimes(1));
    act(() => {
      locationWatchCallbackRef.current?.({
        coords: { latitude: 46.65, longitude: 2.35, accuracy: 6 },
        timestamp: Date.now(),
      });
    });
    await waitFor(() => expect(mockStartHeading).toHaveBeenCalledTimes(1));
    act(() => headingCallbackRef.current?.({ value: 120 }));
    expect(await screen.findByTestId('user-location-heading-cone')).toBeInTheDocument();
    expect(mockMapFlyTo).toHaveBeenCalledTimes(1);

    act(() => view.setDashboardActive(false));
    await waitFor(() => {
      expect(mockClearWatch).toHaveBeenCalledTimes(1);
      expect(mockStopHeading).toHaveBeenCalledTimes(1);
    });
    expect(document.querySelector('[data-layer-id="user-location-dot"]')).not.toBeNull();
    expect(screen.queryByTestId('user-location-heading-cone')).not.toBeInTheDocument();
    expect(screen.getByTestId('my-location-button')).toHaveAttribute('aria-pressed', 'true');

    act(() => view.setDashboardActive(true));
    await waitFor(() => {
      expect(mockWatchPosition).toHaveBeenCalledTimes(2);
      expect(mockStartHeading).toHaveBeenCalledTimes(2);
    });
    act(() => {
      locationWatchCallbackRef.current?.({
        coords: { latitude: 46.66, longitude: 2.36, accuracy: 5 },
        timestamp: Date.now(),
      });
    });
    expect(mockMapFlyTo).toHaveBeenCalledTimes(1);

    act(() => appStateCallbackRef.current?.({ isActive: false }));
    await waitFor(() => {
      expect(mockClearWatch).toHaveBeenCalledTimes(2);
      expect(mockStopHeading).toHaveBeenCalledTimes(2);
    });

    act(() => appStateCallbackRef.current?.({ isActive: true }));
    await waitFor(() => {
      expect(mockWatchPosition).toHaveBeenCalledTimes(3);
      expect(mockStartHeading).toHaveBeenCalledTimes(3);
    });
  });
});

describe('Dashboard -- Geolocation error modal', () => {
  beforeEach(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    vi.clearAllMocks();
    mockGpsRecordingState = 'idle';
    mockController.currentTrackPoints = [];
    locationWatchCallbackRef.current = null;
    appStateCallbackRef.current = null;
    headingCallbackRef.current = null;
    mockRequestPermissions.mockReset().mockResolvedValue({ location: 'granted' });
    mockWatchPosition.mockReset().mockImplementation(
      async (_options: unknown, callback: (position: unknown, error?: unknown) => void) => {
        locationWatchCallbackRef.current = callback;
        return 'live-location-watch';
      },
    );
    mockClearWatch.mockReset().mockResolvedValue(undefined);
  });

  it('shows error modal when permission is denied via requestPermissions return value', async () => {
    mockRequestPermissions.mockResolvedValue({ location: 'denied' });
    renderDashboard();

    const btn = await screen.findByTestId('my-location-button');
    await userEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText('Location Permission Required')).toBeInTheDocument();
    });
  });

  it('shows error modal when requestPermissions rejects (location disabled)', async () => {
    const err = new Error('Location services are not enabled.') as Error & { code: string };
    err.code = 'OS-PLUG-GLOC-0007';
    mockRequestPermissions.mockRejectedValue(err);
    renderDashboard();

    const btn = await screen.findByTestId('my-location-button');
    await userEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText('Location Services Disabled')).toBeInTheDocument();
    });
  });

  it('shows error modal when starting the location watch times out', async () => {
    const err = new Error('Could not obtain location in time.') as Error & { code: string };
    err.code = 'OS-PLUG-GLOC-0010';
    mockWatchPosition.mockRejectedValue(err);
    renderDashboard();

    const btn = await screen.findByTestId('my-location-button');
    await userEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText('Could Not Determine Location')).toBeInTheDocument();
    });
  });

  it('dismisses error modal when OK is clicked', async () => {
    mockRequestPermissions.mockResolvedValue({ location: 'denied' });
    renderDashboard();

    const btn = await screen.findByTestId('my-location-button');
    await userEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText('Location Permission Required')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => {
      expect(screen.queryByText('Location Permission Required')).not.toBeInTheDocument();
    });
  });
});

// ==================== Landmark CRUD ====================

describe('Dashboard -- Landmark CRUD', () => {
  const WRITABLE_LANDMARK = {
    id: 'lm-1',
    name: 'Big Entrance',
    description: 'Main entrance',
    collection: 'col-1',
    collection_name: 'Survey A',
    is_personal_collection: false,
    can_write: true,
    can_delete: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mapPropsRef.current = null;
    mockIsAuthenticated.mockReturnValue(true);
    mockIsOfflineLocked = false;
    mockLandmarksRevision = 0;
    mockMapDataRevision = 1;
    mockProjects = [makeProject({ id: 'p1', name: 'CRUD Project' })];
    mockGetProjectVisibilityPreferences.mockReturnValue({});
    mockGetCountryVisibilityPreferences.mockReturnValue({});
    mockGetCountryCollapsedPreferences.mockReturnValue({});
    mockGetShowLandmarks.mockReturnValue(true);
    mockGetProjectGeoJSON.mockResolvedValue(pointFeatureCollection());
    mockGetOverlayGeoJSON.mockImplementation(async (overlayId: string) =>
      overlayId === 'landmarks'
        ? overlayPointFeatureCollection({ ...WRITABLE_LANDMARK })
        : null,
    );
    mockQueryRenderedFeatures.mockReturnValue([]);
    mockMapGetLayer.mockImplementation((id: string) => ({ id }));
    mockMapGetZoom.mockReturnValue(15);
    mockGetLandmarkCollections.mockResolvedValue([
      { id: 'col-1', name: 'Survey A', color: '#111', isPersonal: false, canWrite: true },
      { id: 'col-personal', name: 'Personal Landmarks', color: '#fff', isPersonal: true, canWrite: true },
    ]);
    mockCreateLandmark.mockResolvedValue({ id: 'lm-new' });
    mockUpdateLandmark.mockResolvedValue({ id: 'lm-1' });
    mockDeleteLandmark.mockResolvedValue(undefined);
  });

  function tapLandmark(props: Record<string, unknown> = {}) {
    mockQueryRenderedFeatures.mockReturnValueOnce([
      {
        layer: { id: 'landmarks-layer' },
        properties: { ...WRITABLE_LANDMARK, ...props },
        geometry: { type: 'Point', coordinates: [2.3, 46.6] },
      },
    ]);
    simulatePointerTap(getMapTouchSurface());
  }

  it('renders a pending offline landmark from the folded overlay', async () => {
    mockGetOverlayGeoJSON.mockImplementation(async (overlayId: string) =>
      overlayId === 'landmarks'
        ? overlayPointFeatureCollection({
            id: 'local:pending-camp',
            name: 'Pending Camp',
            description: 'Created offline',
            collection: '',
            collection_name: 'Personal Landmarks',
            is_personal_collection: true,
            can_write: true,
            can_delete: true,
          })
        : null,
    );

    renderDashboard();

    expect(await screen.findByTestId('landmark-row-local:pending-camp')).toHaveTextContent(
      'Pending Camp',
    );
    expect(document.querySelector('[data-layer-id="landmarks-layer"]')).not.toBeNull();
  });

  // ---- long-press ring ------------------------------------------------------

  it('delays the circular loading ring while holding and removes it on release', async () => {
    try {
      renderDashboard();
      await waitFor(() => {
        expect(document.querySelector('.dashboard-map-touch-surface')).not.toBeNull();
      });
      const surface = getMapTouchSurface();

      // Fake timers ONLY for the synchronous long-press window; render + waitFor
      // above run on real timers. vitest fake timers cannot drive RTL waitFor
      // without `shouldAdvanceTime`, whose background tick fires timer callbacks
      // OUTSIDE act() and made this suite flaky under parallel load.
      await settleAsyncEffects();
      vi.useFakeTimers();
      fireEvent.pointerDown(surface, { pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 80 });
      expect(screen.queryByTestId('long-press-ring')).not.toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(MAP.LONG_PRESS_RING_REVEAL_DELAY_MS); });
      expect(screen.getByTestId('long-press-ring')).toBeInTheDocument();

      fireEvent.pointerUp(surface, { pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 80 });
      expect(screen.queryByTestId('long-press-ring')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not flash the loading ring for a quick tap', async () => {
    try {
      renderDashboard();
      await waitFor(() => {
        expect(document.querySelector('.dashboard-map-touch-surface')).not.toBeNull();
      });
      await waitFor(() => {
        expect(document.querySelector('[data-layer-id="landmarks-layer"]')).not.toBeNull();
      });
      await act(async () => {});
      const surface = getMapTouchSurface();

      // Fake timers ONLY for the synchronous long-press window (see note above).
      await settleAsyncEffects();
      vi.useFakeTimers();
      act(() => {
        fireEvent.pointerDown(surface, { pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 80 });
        fireEvent.pointerUp(surface, { pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 80 });
        vi.advanceTimersByTime(MAP.LONG_PRESS_RING_REVEAL_DELAY_MS);
      });

      expect(screen.queryByTestId('long-press-ring')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes the ring when the finger moves past the tap threshold', async () => {
    try {
      renderDashboard();
      await waitFor(() => {
        expect(document.querySelector('.dashboard-map-touch-surface')).not.toBeNull();
      });
      const surface = getMapTouchSurface();

      // Fake timers ONLY for the synchronous long-press window (see note above).
      await settleAsyncEffects();
      vi.useFakeTimers();
      act(() => {
        fireEvent.pointerDown(surface, { pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 80 });
        vi.advanceTimersByTime(MAP.LONG_PRESS_RING_REVEAL_DELAY_MS);
      });
      expect(screen.getByTestId('long-press-ring')).toBeInTheDocument();

      act(() => {
        fireEvent.pointerMove(surface, { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 400 });
      });
      expect(screen.queryByTestId('long-press-ring')).not.toBeInTheDocument();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('does NOT show the ring when zoomed out too far to create a landmark', async () => {
    mockMapGetZoom.mockReturnValue(MAP.MARKER_INTERACTION_MIN_ZOOM - 1);
    renderDashboard();
    await waitFor(() => {
      expect(document.querySelector('.dashboard-map-touch-surface')).not.toBeNull();
    });
    const surface = getMapTouchSurface();

    await act(async () => {
      fireEvent.pointerDown(surface, { pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 80 });
    });
    expect(screen.queryByTestId('long-press-ring')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.pointerUp(surface, { pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 80 });
    });
  });

  it('still requires an empty spot: a long press on a marker does not open Map Point', async () => {
    try {
      renderDashboard();
      await waitFor(() => {
        expect(document.querySelector('.dashboard-map-touch-surface')).not.toBeNull();
      });
      const surface = getMapTouchSurface();

      // Fake timers ONLY for the synchronous long-press window (see note above).
      await settleAsyncEffects();
      vi.useFakeTimers();
      fireEvent.pointerDown(surface, { pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 80 });
      // The spot is occupied by a marker when the ring would normally appear.
      const markerHit = [
        { layer: { id: 'landmarks-layer' }, properties: { id: 'lm-1' }, geometry: { type: 'Point', coordinates: [2.3, 46.6] } },
      ];
      mockQueryRenderedFeatures
        .mockReturnValueOnce(markerHit)
        .mockReturnValueOnce(markerHit);
      act(() => { vi.advanceTimersByTime(MAP.LONG_PRESS_RING_REVEAL_DELAY_MS); });
      expect(screen.queryByTestId('long-press-ring')).not.toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(MAP.LONG_PRESS_DURATION_MS); });

      expect(screen.queryByTestId('create-landmark-button')).not.toBeInTheDocument();
      expect(screen.queryByTestId('long-press-ring')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // ---- create flow ----------------------------------------------------------

  it('opens the create form from a long-press map point and creates a landmark', async () => {
    try {
      renderDashboard();
      await waitFor(() => {
        expect(document.querySelector('.dashboard-map-touch-surface')).not.toBeNull();
      });
      const surface = getMapTouchSurface();

      // Fake timers ONLY for the synchronous long-press window (see note above);
      // the modal + create flow below runs back on real timers so its async
      // awaits and the toast auto-dismiss timer never fire outside act().
      await settleAsyncEffects();
      vi.useFakeTimers();
      fireEvent.pointerDown(surface, { pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 80 });
      act(() => { vi.advanceTimersByTime(MAP.LONG_PRESS_DURATION_MS); });
      vi.useRealTimers();

      // Map Point modal now offers Create Landmark.
      expect(screen.getByTestId('create-landmark-button')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('create-landmark-button'));

      expect(screen.getByTestId('landmark-form-modal')).toBeInTheDocument();
      expect(screen.getByText('Create Landmark')).toBeInTheDocument();

      fireEvent.change(screen.getByTestId('landmark-name-input'), { target: { value: 'New Spot' } });
      fireEvent.click(screen.getByTestId('landmark-form-submit'));

      await act(async () => { await Promise.resolve(); });

      expect(mockCreateLandmark).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Spot' }),
      );
      await waitFor(() => {
        expect(screen.queryByTestId('landmark-form-modal')).not.toBeInTheDocument();
      });
      expect(screen.getByTestId('landmark-toast')).toHaveTextContent('Landmark created');
      expect(mockGetLandmarkCollections).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the create form open and shows the error when offline', async () => {
    try {
      mockCreateLandmark.mockRejectedValue(
        new LandmarkMutationError('offline', 'Landmark changes are not available offline yet.'),
      );
      renderDashboard();
      await waitFor(() => {
        expect(document.querySelector('.dashboard-map-touch-surface')).not.toBeNull();
      });
      const surface = getMapTouchSurface();

      // Fake timers ONLY for the synchronous long-press window (see note above);
      // the create flow below runs back on real timers.
      await settleAsyncEffects();
      vi.useFakeTimers();
      fireEvent.pointerDown(surface, { pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 80 });
      act(() => { vi.advanceTimersByTime(MAP.LONG_PRESS_DURATION_MS); });
      vi.useRealTimers();
      fireEvent.click(screen.getByTestId('create-landmark-button'));
      fireEvent.change(screen.getByTestId('landmark-name-input'), { target: { value: 'New Spot' } });
      fireEvent.click(screen.getByTestId('landmark-form-submit'));

      await act(async () => { await Promise.resolve(); });

      expect(screen.getByTestId('landmark-form-modal')).toBeInTheDocument();
      expect(screen.getByTestId('landmark-submit-error')).toHaveTextContent(
        'Landmark changes are not available offline yet.',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // ---- edit flow ------------------------------------------------------------

  it('opens the edit form from a writable landmark and saves changes', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="landmarks-layer"]')).not.toBeNull();
    });

    tapLandmark();
    expect(screen.getByTestId('overlay-marker-details-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('edit-landmark-button'));
    expect(screen.getByTestId('landmark-form-modal')).toBeInTheDocument();
    expect(screen.getByText('Edit Landmark')).toBeInTheDocument();
    expect(screen.getByTestId('landmark-name-input')).toHaveValue('Big Entrance');

    fireEvent.change(screen.getByTestId('landmark-name-input'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByTestId('landmark-form-submit'));

    await act(async () => { await Promise.resolve(); });

    expect(mockUpdateLandmark).toHaveBeenCalledWith(
      'lm-1',
      expect.objectContaining({ name: 'Renamed' }),
    );
    await waitFor(() => {
      expect(screen.queryByTestId('landmark-form-modal')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('landmark-toast')).toHaveTextContent('Landmark updated');
  });

  // ---- delete flow ----------------------------------------------------------

  it('deletes a landmark after confirmation', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="landmarks-layer"]')).not.toBeNull();
    });

    tapLandmark();
    fireEvent.click(screen.getByTestId('delete-landmark-button'));

    expect(screen.getByTestId('delete-landmark-confirm')).toBeInTheDocument();
    expect(screen.getByTestId('delete-landmark-confirm-warning')).toHaveTextContent(
      'This action cannot be undone.',
    );

    fireEvent.click(screen.getByTestId('delete-landmark-confirm-confirm'));
    await act(async () => { await Promise.resolve(); });

    expect(mockDeleteLandmark).toHaveBeenCalledWith('lm-1');
    await waitFor(() => {
      expect(screen.queryByTestId('delete-landmark-confirm')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('landmark-toast')).toHaveTextContent('Landmark deleted');
  });

  it('does not delete when the confirmation is cancelled', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="landmarks-layer"]')).not.toBeNull();
    });

    tapLandmark();
    fireEvent.click(screen.getByTestId('delete-landmark-button'));
    fireEvent.click(screen.getByTestId('delete-landmark-confirm-cancel'));

    expect(mockDeleteLandmark).not.toHaveBeenCalled();
    expect(screen.queryByTestId('delete-landmark-confirm')).not.toBeInTheDocument();
  });

  it('surfaces an error toast when deletion fails', async () => {
    mockDeleteLandmark.mockRejectedValue(
      new LandmarkMutationError('permission', 'You do not have permission to modify this landmark.'),
    );
    renderDashboard();
    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="landmarks-layer"]')).not.toBeNull();
    });

    tapLandmark();
    fireEvent.click(screen.getByTestId('delete-landmark-button'));
    fireEvent.click(screen.getByTestId('delete-landmark-confirm-confirm'));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByTestId('landmark-toast')).toHaveTextContent(
      'You do not have permission to modify this landmark.',
    );
  });

  // ---- permission gating ----------------------------------------------------

  it('hides Edit/Delete for a read-only landmark', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(document.querySelector('[data-layer-id="landmarks-layer"]')).not.toBeNull();
    });

    tapLandmark({ can_write: false, can_delete: false });
    expect(screen.getByTestId('overlay-marker-details-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('edit-landmark-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('delete-landmark-button')).not.toBeInTheDocument();
  });
});

describe('Dashboard GPS panel', () => {
  beforeEach(() => {
    mockIsOfflineLocked = false;
    mockGpsRecordingState = 'idle';
    mockGpsTracks = [];
    vi.clearAllMocks();
  });

  it('renders the GPS panel and tab', async () => {
    renderDashboard();
    await screen.findByTestId('app-tab-bar');
    expect(screen.getByTestId('gps-tab')).toBeInTheDocument();
    expect(screen.getByTestId('gps-panel')).toBeInTheDocument();
    // The panel opens the dedicated recorder; it has no inline Start.
    expect(screen.getByTestId('gps-open-recorder')).toBeInTheDocument();
    expect(screen.queryByTestId('gps-recording-screen')).not.toBeInTheDocument();
  });

  it('opens the dedicated recording screen and starts recording from it', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByTestId('app-tab-bar');

    await user.click(screen.getByTestId('gps-tab'));
    await user.click(screen.getByTestId('gps-open-recorder'));

    // The full-screen recorder is now shown, with its own back button + Start.
    expect(screen.getByTestId('gps-recording-screen')).toBeInTheDocument();
    expect(screen.getByTestId('gps-recording-back')).toBeInTheDocument();

    await user.click(screen.getByTestId('gps-start-recording'));
    expect(mockController.startTrackRecording).toHaveBeenCalledTimes(1);
  });

  it('leaves the recording screen via the back button (recording not stopped)', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByTestId('app-tab-bar');

    await user.click(screen.getByTestId('gps-tab'));
    await user.click(screen.getByTestId('gps-open-recorder'));
    await user.click(screen.getByTestId('gps-recording-back'));

    expect(screen.queryByTestId('gps-recording-screen')).not.toBeInTheDocument();
    expect(mockController.stopTrackRecording).not.toHaveBeenCalled();
  });

  it('Cancel just closes the recording screen when idle (no confirm, no discard)', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByTestId('app-tab-bar');

    await user.click(screen.getByTestId('gps-tab'));
    await user.click(screen.getByTestId('gps-open-recorder'));
    await user.click(screen.getByTestId('gps-recording-cancel'));

    expect(screen.queryByTestId('gps-recording-screen')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gps-recording-cancel-confirm')).not.toBeInTheDocument();
    expect(mockController.discardTrackRecording).not.toHaveBeenCalled();
  });

  it('Cancel while recording confirms, then discards and closes', async () => {
    mockGpsRecordingState = 'recording';
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByTestId('app-tab-bar');

    await user.click(screen.getByTestId('gps-tab'));
    await user.click(screen.getByTestId('gps-open-recorder'));
    await user.click(screen.getByTestId('gps-recording-cancel'));

    // A confirmation appears; the screen is still open and nothing discarded yet.
    expect(screen.getByTestId('gps-recording-cancel-confirm')).toBeInTheDocument();
    expect(mockController.discardTrackRecording).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('gps-recording-cancel-confirm-confirm'));
    expect(mockController.discardTrackRecording).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('gps-recording-screen')).not.toBeInTheDocument();
  });

  it('dismissing the cancel confirmation keeps recording', async () => {
    mockGpsRecordingState = 'recording';
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByTestId('app-tab-bar');

    await user.click(screen.getByTestId('gps-tab'));
    await user.click(screen.getByTestId('gps-open-recorder'));
    await user.click(screen.getByTestId('gps-recording-cancel'));
    await user.click(screen.getByTestId('gps-recording-cancel-confirm-cancel'));

    expect(mockController.discardTrackRecording).not.toHaveBeenCalled();
    expect(screen.getByTestId('gps-recording-screen')).toBeInTheDocument();
  });

  it('opens the averaging modal from High-Accuracy GPS Point', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByTestId('app-tab-bar');

    await user.click(screen.getByTestId('gps-tab'));
    await user.click(screen.getByTestId('gps-collect-point'));

    expect(screen.getByTestId('gps-averaging-modal')).toBeInTheDocument();
  });

  it('confirms before uploading a saved GPS track', async () => {
    const user = userEvent.setup();
    mockGpsTracks = [
      {
        id: 'trk-upload',
        name: 'Surface Walk',
        color: '#e41a1c',
        origin: 'local',
        createdAt: 1000,
        updatedAt: 16_000,
        pointCount: 2,
        distanceMeters: 10,
        durationMs: 15_000,
      },
    ];
    mockController.uploadGpsTrack.mockResolvedValueOnce(undefined);
    renderDashboard();
    await screen.findByTestId('app-tab-bar');

    await user.click(screen.getByTestId('gps-tab'));
    await user.click(screen.getByTestId('gps-track-upload-trk-upload'));

    expect(screen.getByTestId('gps-upload-confirm')).toBeInTheDocument();
    expect(screen.getByTestId('gps-upload-confirm')).toHaveTextContent('Surface Walk');
    expect(mockController.uploadGpsTrack).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('gps-upload-confirm-confirm'));

    await waitFor(() =>
      expect(mockController.uploadGpsTrack).toHaveBeenCalledWith('trk-upload'),
    );
    expect(await screen.findByTestId('landmark-toast')).toHaveTextContent('Track uploaded to SpeleoDB');
  });

  it('surfaces an error when an upload fails', async () => {
    const user = userEvent.setup();
    mockGpsTracks = [
      {
        id: 'trk-bad-gpx',
        name: 'Broken Track',
        color: '#377eb8',
        origin: 'local',
        createdAt: 1000,
        updatedAt: 16_000,
        pointCount: 2,
        distanceMeters: 10,
        durationMs: 15_000,
      },
    ];
    mockController.uploadGpsTrack.mockRejectedValueOnce(new Error('Upload failed'));
    allowConsoleWarn('GPS track action failed.', expect.objectContaining({ phase: 'upload' }));
    renderDashboard();
    await screen.findByTestId('app-tab-bar');

    await user.click(screen.getByTestId('gps-tab'));
    await user.click(screen.getByTestId('gps-track-upload-trk-bad-gpx'));
    await user.click(screen.getByTestId('gps-upload-confirm-confirm'));

    expect(await screen.findByTestId('landmark-toast')).toHaveTextContent(
      'Could not upload the GPS track.',
    );
  });

  it('toggles a track onto the map and loads its geometry', async () => {
    const user = userEvent.setup();
    mockGpsTracks = [
      {
        id: 'trk-visible',
        name: 'Resurgence',
        color: '#4daf4a',
        origin: 'remote',
        createdAt: 2000,
        updatedAt: 2000,
      },
    ];
    mockController.getGpsTrackPoints.mockResolvedValueOnce([
      { latitude: 45, longitude: -73, timestamp: 0 },
      { latitude: 45.001, longitude: -73.001, timestamp: 0 },
    ]);
    renderDashboard();
    await screen.findByTestId('app-tab-bar');

    await user.click(screen.getByTestId('gps-tab'));
    const toggle = screen.getByTestId('gps-track-visibility-trk-visible').querySelector('input')!;
    await user.click(toggle);

    await waitFor(() =>
      expect(mockController.getGpsTrackPoints).toHaveBeenCalledWith('trk-visible'),
    );
  });

  it('zooms the map to a track when its row is tapped', async () => {
    const user = userEvent.setup();
    mockGpsTracks = [
      {
        id: 'trk-zoom',
        name: 'Traverse',
        color: '#984ea3',
        origin: 'remote',
        createdAt: 3000,
        updatedAt: 3000,
      },
    ];
    mockController.getGpsTrackPoints.mockResolvedValue([
      { latitude: 45, longitude: -73, timestamp: 0 },
      { latitude: 45.01, longitude: -73.02, timestamp: 0 },
    ]);
    renderDashboard();
    await screen.findByTestId('app-tab-bar');

    await user.click(screen.getByTestId('gps-tab'));
    await user.click(screen.getByTestId('gps-track-zoom-trk-zoom'));

    await waitFor(() =>
      expect(mockController.getGpsTrackPoints).toHaveBeenCalledWith('trk-zoom'),
    );
    await waitFor(() => expect(mockMapFitBounds).toHaveBeenCalled());
  });

  it('marks the selected color in the edit modal with a contrasting checkmark', async () => {
    const user = userEvent.setup();
    // A light swatch -> the contrasting cue must use BLACK ink (a white border
    // would be invisible here; that was the bug).
    mockGpsTracks = [
      {
        id: 'trk-edit',
        name: 'Sump',
        color: '#ffff33',
        origin: 'remote',
        createdAt: 4000,
        updatedAt: 4000,
      },
    ];
    renderDashboard();
    await screen.findByTestId('app-tab-bar');

    await user.click(screen.getByTestId('gps-tab'));
    await user.click(screen.getByTestId('gps-track-edit-trk-edit'));

    expect(screen.getByTestId('gps-edit-modal')).toBeInTheDocument();
    const selected = screen.getByTestId('gps-edit-color-#ffff33');
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    // Selection cue is an overlaid checkmark (works on any swatch), black on a
    // light color for contrast.
    const check = selected.querySelector('svg');
    expect(check).not.toBeNull();
    expect(check?.getAttribute('stroke')).toBe('#000000');
    // Unselected swatches show no checkmark.
    expect(
      screen.getByTestId('gps-edit-color-#377eb8').querySelector('svg'),
    ).toBeNull();

    // Selecting a dark swatch moves the cue and switches the ink to white.
    await user.click(screen.getByTestId('gps-edit-color-#377eb8'));
    const darkSelected = screen.getByTestId('gps-edit-color-#377eb8');
    expect(darkSelected.querySelector('svg')?.getAttribute('stroke')).toBe('#ffffff');
    expect(screen.getByTestId('gps-edit-color-#ffff33').querySelector('svg')).toBeNull();
  });

  it('opens the edit modal without crashing for a track missing a color (older build)', async () => {
    const user = userEvent.setup();
    // A track recorded before `color` existed loads with color === undefined.
    // Previously the modal's `editColor.toLowerCase()` threw and the whole app
    // fell back to the error boundary ("Something went wrong").
    mockGpsTracks = [
      {
        id: 'trk-legacy',
        name: 'Legacy',
        color: undefined as unknown as string,
        origin: 'local',
        createdAt: 5000,
        updatedAt: 5000,
        pointCount: 2,
        distanceMeters: 10,
        durationMs: 15_000,
      },
    ];
    renderDashboard();
    await screen.findByTestId('app-tab-bar');

    await user.click(screen.getByTestId('gps-tab'));
    await user.click(screen.getByTestId('gps-track-edit-trk-legacy'));

    // The modal renders (no crash) with no swatch selected.
    expect(screen.getByTestId('gps-edit-modal')).toBeInTheDocument();
    const swatches = screen.getAllByTestId(/^gps-edit-color-#/);
    expect(swatches.length).toBeGreaterThan(0);
    expect(swatches.every((s) => s.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('collapses the recording screen when a bottom tab is pressed', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByTestId('app-tab-bar');

    await user.click(screen.getByTestId('gps-tab'));
    await user.click(screen.getByTestId('gps-open-recorder'));
    expect(screen.getByTestId('gps-recording-screen')).toBeInTheDocument();

    // Tapping a menu tab collapses the overlay and reveals that tab's view.
    await user.click(screen.getByTestId('map-tab'));
    expect(screen.queryByTestId('gps-recording-screen')).not.toBeInTheDocument();
  });

  it('collapses the averaging view when a bottom tab is pressed', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByTestId('app-tab-bar');

    await user.click(screen.getByTestId('gps-tab'));
    await user.click(screen.getByTestId('gps-collect-point'));
    expect(screen.getByTestId('gps-averaging-modal')).toBeInTheDocument();

    await user.click(screen.getByTestId('map-tab'));
    expect(screen.queryByTestId('gps-averaging-modal')).not.toBeInTheDocument();
  });
});
