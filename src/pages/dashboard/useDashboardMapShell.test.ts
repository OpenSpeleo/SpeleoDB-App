import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import type { MapRef, ViewStateChangeEvent } from 'react-map-gl/maplibre';
import { MAP } from '../../constants';
import type { LocationWatcher } from '../../services/GeolocationWatcher';
import type { RecordedPoint } from '../../types/gpsTrack';
import type { MapLayerId } from '../../types/mapLayer';
import { PERMISSION_DENIED_SENTINEL } from '../../utils/geolocationError';
import type { OverlayIconAvailability, OverlayImageMap } from './dashboardMapUtils';
import {
  useDashboardMapShell,
  type DashboardMapShellDependencies,
} from './useDashboardMapShell';

const {
  mockGetCachedLayerStyle,
  mockPersistSelectedMapLayerId,
  mockRequestPermissions,
  mockWatchPosition,
  mockClearWatch,
  mockImpact,
  mockLoadMapImage,
  mockLockMapOrientation,
} = vi.hoisted(() => ({
  mockGetCachedLayerStyle: vi.fn(),
  mockPersistSelectedMapLayerId: vi.fn(),
  mockRequestPermissions: vi.fn(),
  mockWatchPosition: vi.fn(),
  mockClearWatch: vi.fn(),
  mockImpact: vi.fn(),
  mockLoadMapImage: vi.fn(),
  mockLockMapOrientation: vi.fn(),
}));

vi.mock('../../services/TileCacheService', () => ({
  getCachedLayerStyle: mockGetCachedLayerStyle,
}));

vi.mock('../../services/PreferencesService', () => ({
  setSelectedMapLayerId: mockPersistSelectedMapLayerId,
}));

vi.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    requestPermissions: mockRequestPermissions,
    watchPosition: mockWatchPosition,
    clearWatch: mockClearWatch,
  },
}));

vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: mockImpact },
  ImpactStyle: { Light: 'LIGHT' },
}));

vi.mock('./dashboardMapUtils', async (importOriginal) => ({
  ...await importOriginal<typeof import('./dashboardMapUtils')>(),
  loadMapImage: mockLoadMapImage,
  lockMapOrientation: mockLockMapOrientation,
}));

const ICONS: OverlayIconAvailability = {
  'biology-station-icon': true,
  'bone-station-icon': true,
  'artifact-station-icon': true,
  'geology-station-icon': true,
  'exploration-lead-icon': true,
  'cylinder-icon': true,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createMapRef(map: OverlayImageMap & { flyTo: ReturnType<typeof vi.fn> } | null = null) {
  return {
    current: map ? { getMap: () => map } : null,
  } as unknown as RefObject<MapRef | null>;
}

function createDependencies(
  overrides: Partial<DashboardMapShellDependencies> = {},
): DashboardMapShellDependencies {
  return {
    getLayerStyle: vi.fn(async (layerId) => ({ version: 8, layerId })),
    persistLayerId: vi.fn(),
    locationWatcher: {
      requestPermissions: vi.fn(async () => 'granted'),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    },
    impact: vi.fn(async () => undefined),
    loadIcons: vi.fn(async () => ICONS),
    lockOrientation: vi.fn(),
    reportStyleError: vi.fn(),
    ...overrides,
  };
}

function createLocationWatcher(permission = 'granted') {
  let onFix: ((point: RecordedPoint) => void) | null = null;
  let onError: ((error: unknown) => void) | undefined;
  const watcher: LocationWatcher = {
    requestPermissions: vi.fn(async () => permission),
    start: vi.fn(async (_options, nextFix, nextError) => {
      onFix = nextFix;
      onError = nextError;
    }),
    stop: vi.fn(async () => undefined),
  };
  return {
    watcher,
    emit(point: RecordedPoint) { onFix?.(point); },
    fail(error: unknown) { onError?.(error); },
  };
}

function viewStateEvent(zoom: number, latitude: number): ViewStateChangeEvent {
  return { viewState: { zoom, latitude } } as ViewStateChangeEvent;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('useDashboardMapShell', () => {
  it('loads style and icons, locks orientation, and ignores map loads without a map', async () => {
    const map = { flyTo: vi.fn() } as unknown as OverlayImageMap & {
      flyTo: ReturnType<typeof vi.fn>;
    };
    const mapRef = createMapRef(map);
    const dependencies = createDependencies();
    const { result } = renderHook(() => useDashboardMapShell({
      mapRef,
      selectedMapLayerId: 'esri-satellite',
      onSelectedMapLayerIdChange: vi.fn(),
      dependencies,
    }));

    await waitFor(() => expect(result.current.mapStyle).toEqual({
      version: 8,
      layerId: 'esri-satellite',
    }));
    act(() => result.current.handleMapLoad());
    await waitFor(() => expect(result.current.overlayIconsLoaded).toBe(true));
    expect(result.current.overlayIconAvailability).toBe(ICONS);
    expect(dependencies.lockOrientation).toHaveBeenCalledWith(mapRef.current);
    expect(dependencies.loadIcons).toHaveBeenCalledWith(map);

    mapRef.current = null;
    act(() => result.current.handleMapLoad());
    expect(dependencies.lockOrientation).toHaveBeenLastCalledWith(null);
    expect(dependencies.loadIcons).toHaveBeenCalledOnce();
  });

  it('persists valid layer selections and falls back for unknown identifiers', async () => {
    const dependencies = createDependencies();
    const onChange = vi.fn();
    const { result } = renderHook(() => useDashboardMapShell({
      mapRef: createMapRef(),
      selectedMapLayerId: 'esri-satellite',
      onSelectedMapLayerIdChange: onChange,
      dependencies,
    }));
    await waitFor(() => expect(result.current.mapStyle).not.toBeNull());

    act(() => {
      result.current.selectMapLayer('esri-world-hillshade');
      result.current.selectMapLayer('unknown');
    });
    expect(dependencies.persistLayerId).toHaveBeenNthCalledWith(1, 'esri-world-hillshade');
    expect(dependencies.persistLayerId).toHaveBeenNthCalledWith(2, 'esri-satellite');
    expect(onChange.mock.calls).toEqual([
      ['esri-world-hillshade'],
      ['esri-satellite'],
    ]);
  });

  it('publishes only finite changed viewport metrics', async () => {
    const dependencies = createDependencies();
    const { result } = renderHook(() => useDashboardMapShell({
      mapRef: createMapRef(),
      selectedMapLayerId: 'esri-satellite',
      onSelectedMapLayerIdChange: vi.fn(),
      dependencies,
    }));
    await waitFor(() => expect(result.current.mapStyle).not.toBeNull());
    const initial = result.current.mapViewMetrics;

    act(() => result.current.handleMapMove(viewStateEvent(Number.NaN, 45)));
    expect(result.current.mapViewMetrics).toBe(initial);
    act(() => result.current.handleMapMove(viewStateEvent(MAP.DEFAULT_ZOOM, MAP.DEFAULT_CENTER[1])));
    expect(result.current.mapViewMetrics).toBe(initial);
    act(() => result.current.handleMapMove(viewStateEvent(12, Number.POSITIVE_INFINITY)));
    expect(result.current.mapViewMetrics).toBe(initial);
    act(() => result.current.handleMapMove(viewStateEvent(12, 46)));
    expect(result.current.mapViewMetrics).toEqual({ zoom: 12, latitude: 46 });
  });

  it('toggles live location, flies on the first fix, and contains rejected haptics', async () => {
    const map = { flyTo: vi.fn() } as unknown as OverlayImageMap & {
      flyTo: ReturnType<typeof vi.fn>;
    };
    const location = createLocationWatcher();
    const hapticError = new Error('haptic unavailable');
    const dependencies = createDependencies({
      locationWatcher: location.watcher,
      impact: vi.fn(async () => { throw hapticError; }),
    });
    const { result } = renderHook(() => useDashboardMapShell({
      mapRef: createMapRef(map),
      selectedMapLayerId: 'esri-satellite',
      onSelectedMapLayerIdChange: vi.fn(),
      dependencies,
    }));

    act(() => result.current.toggleLocationMode());
    await waitFor(() => expect(location.watcher.start).toHaveBeenCalled());
    act(() => location.emit({ longitude: -73.1, latitude: 45.5, timestamp: 1 }));
    expect(result.current.userLocation).toEqual({ lng: -73.1, lat: 45.5 });
    expect(result.current.locationModeActive).toBe(true);
    expect(map.flyTo).toHaveBeenCalledWith({
      center: [-73.1, 45.5],
      zoom: 15,
      duration: 1200,
    });
    expect(dependencies.impact).toHaveBeenCalledOnce();
    expect(result.current.geoError).toBeNull();
    act(() => result.current.toggleLocationMode());
    expect(result.current.userLocation).toBeNull();
    expect(result.current.locationModeActive).toBe(false);
    await waitFor(() => expect(location.watcher.stop).toHaveBeenCalled());
  });

  it('exposes and dismisses permission denial from the shared live-location seam', async () => {
    const location = createLocationWatcher('denied');
    const dependencies = createDependencies({ locationWatcher: location.watcher });
    const { result } = renderHook(() => useDashboardMapShell({
      mapRef: createMapRef(),
      selectedMapLayerId: 'esri-satellite',
      onSelectedMapLayerIdChange: vi.fn(),
      dependencies,
    }));
    act(() => result.current.toggleLocationMode());
    await waitFor(() => expect(result.current.geoError).toBe(PERMISSION_DENIED_SENTINEL));
    expect(location.watcher.start).not.toHaveBeenCalled();
    act(() => result.current.dismissGeoError());
    expect(result.current.geoError).toBeNull();
  });

  it('suppresses stale style success while reporting style failures', async () => {
    const first = deferred<Record<string, unknown>>();
    const failure = new Error('style failed');
    const dependencies = createDependencies({
      getLayerStyle: vi.fn()
        .mockImplementationOnce(() => first.promise)
        .mockRejectedValueOnce(failure),
    });
    const mapRef = createMapRef();
    const onChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ layerId }: { layerId: MapLayerId }) => useDashboardMapShell({
        mapRef,
        selectedMapLayerId: layerId,
        onSelectedMapLayerIdChange: onChange,
        dependencies,
      }),
      { initialProps: { layerId: 'esri-satellite' as MapLayerId } },
    );
    rerender({ layerId: 'esri-world-hillshade' });
    await waitFor(() => expect(dependencies.reportStyleError).toHaveBeenCalledWith(failure));
    await act(async () => first.resolve({ stale: true }));
    expect(result.current.mapStyle).toBeNull();
  });

  it('wires the native defaults and redacted style diagnostics', async () => {
    mockGetCachedLayerStyle.mockResolvedValue({ version: 8 });
    mockRequestPermissions.mockResolvedValue({ location: 'granted' });
    let nativeCallback: ((position: {
      coords: { longitude: number; latitude: number };
      timestamp: number;
    } | null, error?: unknown) => void) | null = null;
    mockWatchPosition.mockImplementation(async (_options, callback) => {
      nativeCallback = callback;
      return 'watch-1';
    });
    mockClearWatch.mockResolvedValue(undefined);
    mockImpact.mockRejectedValue(new Error('no haptics'));
    mockLoadMapImage.mockResolvedValue(true);
    const map = { flyTo: vi.fn() } as unknown as OverlayImageMap & {
      flyTo: ReturnType<typeof vi.fn>;
    };
    const mapRef = createMapRef(map);
    const onChange = vi.fn();
    const { result } = renderHook(() => useDashboardMapShell({
      mapRef,
      selectedMapLayerId: 'esri-satellite',
      onSelectedMapLayerIdChange: onChange,
    }));

    await waitFor(() => expect(result.current.mapStyle).toEqual({ version: 8 }));
    act(() => {
      result.current.selectMapLayer('esri-world-hillshade');
      result.current.handleMapLoad();
    });
    await waitFor(() => expect(result.current.overlayIconsLoaded).toBe(true));
    act(() => result.current.toggleLocationMode());
    await waitFor(() => expect(mockWatchPosition).toHaveBeenCalled());
    act(() => nativeCallback?.({
      coords: { longitude: 2.3, latitude: 46.6 },
      timestamp: 1,
    }));
    expect(mockPersistSelectedMapLayerId).toHaveBeenCalledWith('esri-world-hillshade');
    expect(mockRequestPermissions).toHaveBeenCalledWith({ permissions: ['location'] });
    expect(mockWatchPosition).toHaveBeenCalledWith({
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 0,
      interval: 1_000,
      minimumUpdateInterval: 1_000,
    }, expect.any(Function));
    expect(mockImpact).toHaveBeenCalledWith({ style: 'LIGHT' });
    expect(mockLoadMapImage).toHaveBeenCalledTimes(6);
    expect(mockLockMapOrientation).toHaveBeenCalledWith(mapRef.current);

    const styleError = new Error('cache failed');
    mockGetCachedLayerStyle.mockRejectedValueOnce(styleError);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderHook(() => useDashboardMapShell({
      mapRef,
      selectedMapLayerId: 'esri-world-hillshade',
      onSelectedMapLayerIdChange: onChange,
    }));
    await waitFor(() => expect(consoleError).toHaveBeenCalledWith(
      'Failed to load map style:',
      styleError,
    ));
  });
});
