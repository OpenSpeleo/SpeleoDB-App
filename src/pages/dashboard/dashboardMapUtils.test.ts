import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allowConsoleWarn } from '../../test/consoleGuard';
import type { InteractiveOverlayFeature } from '../../utils/overlayMarkerDetails';
import {
  boundsFromPoints,
  computeBounds,
  filterOverlayByProjectVisibility,
  getClickedOverlayMarkerDetails,
  getMarkerHitQueryBounds,
  loadMapImage,
  lockMapOrientation,
  normalizeOverlayGeoJSON,
  type OverlayIconId,
} from './dashboardMapUtils';

const FEATURE_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { project: 'one' },
    geometry: { type: 'Point', coordinates: [2, 46] },
  }],
};

const POINT_GEOMETRY: GeoJSON.Point = { type: 'Point', coordinates: [2, 46] };

function projectBounds(
  west: number,
  east: number,
  south: number,
  north: number,
  crossesDateline = false,
) {
  return { west, east, south, north, crossesDateline };
}

function imageMap(options: {
  hasImage?: boolean;
  loadError?: Error | null;
  loadedImage?: unknown;
} = {}) {
  return {
    hasImage: vi.fn(() => options.hasImage ?? false),
    addImage: vi.fn(),
    loadImage: vi.fn((_url: string, callback: (error?: Error | null, image?: unknown) => void) => {
      callback(options.loadError, options.loadedImage);
    }),
  };
}

describe('dashboardMapUtils', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('normalizes station colors while preserving unrelated overlays', () => {
    expect(normalizeOverlayGeoJSON('landmarks', FEATURE_COLLECTION)).toBe(FEATURE_COLLECTION);
    const stations: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { color: '#111111' }, geometry: POINT_GEOMETRY },
        { type: 'Feature', properties: { tag: { color: '#222222' } }, geometry: POINT_GEOMETRY },
        { type: 'Feature', properties: { tag: {} }, geometry: POINT_GEOMETRY },
        { type: 'Feature', properties: null, geometry: POINT_GEOMETRY },
      ],
    };

    const normalized = normalizeOverlayGeoJSON('surfaceStations', stations);
    expect(normalized.features.map((feature) => feature.properties?.color)).toEqual([
      '#111111', '#222222', '#fb923c', '#fb923c',
    ]);
    expect(normalizeOverlayGeoJSON('subsurfaceStations', stations)).not.toBe(stations);
  });

  it('filters project-linked overlays for string and numeric project IDs', () => {
    const features: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { project: 'one' }, geometry: POINT_GEOMETRY },
        { type: 'Feature', properties: { project: 2 }, geometry: POINT_GEOMETRY },
        { type: 'Feature', properties: { project: '' }, geometry: POINT_GEOMETRY },
        { type: 'Feature', properties: {}, geometry: POINT_GEOMETRY },
        { type: 'Feature', properties: null, geometry: POINT_GEOMETRY },
      ],
    };
    expect(filterOverlayByProjectVisibility('landmarks', features, new Set())).toBe(features);
    expect(filterOverlayByProjectVisibility(
      'explorationLeads', features, new Set(['one', '2']),
    ).features).toHaveLength(2);

    const cylinders: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', properties: { project_id: 'one' }, geometry: POINT_GEOMETRY,
      }],
    };
    expect(filterOverlayByProjectVisibility(
      'cylinderInstalls', cylinders, new Set(['one']),
    ).features).toHaveLength(1);
  });

  it('selects the first parseable marker in explicit layer order', () => {
    const features: InteractiveOverlayFeature[] = [
      { layer: { id: 'surface-stations-layer' }, id: 'surface', properties: { name: 'S' } },
      { layer: { id: 'exploration-leads-icon-layer' }, id: 'lead', properties: {} },
    ];
    expect(getClickedOverlayMarkerDetails(features, [
      'missing', 'exploration-leads-icon-layer', 'surface-stations-layer',
    ])).toMatchObject({ type: 'explorationLead', id: 'lead' });
    expect(getClickedOverlayMarkerDetails([
      { layer: { id: 'unknown' } },
    ], ['unknown'])).toBeNull();
    expect(getClickedOverlayMarkerDetails([], ['missing'])).toBeNull();
  });

  it('creates a square marker hit box', () => {
    expect(getMarkerHitQueryBounds({ x: 10, y: 20 }, 3)).toEqual([[7, 17], [13, 23]]);
  });

  it('computes padded project bounds and handles dateline crossing', () => {
    expect(computeBounds({}, new Set(['missing']))).toBeNull();
    expect(computeBounds({
      one: projectBounds(1, 3, 40, 42),
    }, new Set(['one']))).toEqual([[0.8, 39.8], [3.2, 42.2]]);

    const dateline = computeBounds({
      west: projectBounds(170, -170, -10, 10, true),
    }, new Set(['west'])) as [[number, number], [number, number]];
    expect(dateline[0][0]).toBe(168);
    expect(dateline[1][0]).toBe(192);
  });

  it('bounds valid GPS points and ignores malformed coordinates', () => {
    expect(boundsFromPoints([])).toBeNull();
    expect(boundsFromPoints([
      { latitude: Number.NaN, longitude: 2, timestamp: 0 },
      { latitude: 46, longitude: Number.POSITIVE_INFINITY, timestamp: 0 },
    ])).toBeNull();
    expect(boundsFromPoints([
      { latitude: 46, longitude: 2, timestamp: 0 },
      { latitude: 47, longitude: 4, timestamp: 1 },
    ])).toEqual([[1.8, 45.9], [4.2, 47.1]]);
  });

  it('returns immediately when an icon is already registered', async () => {
    const map = imageMap({ hasImage: true });
    await expect(loadMapImage(map, 'biology-station-icon', '/icon.png')).resolves.toBe(true);
    expect(map.addImage).not.toHaveBeenCalled();
    expect(map.loadImage).not.toHaveBeenCalled();
  });

  it('loads an icon through fetch and createImageBitmap', async () => {
    const bitmap = { width: 10 };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob() })));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
    const map = imageMap();

    await expect(loadMapImage(map, 'bone-station-icon', '/icon.png')).resolves.toBe(true);
    expect(map.addImage).toHaveBeenCalledWith('bone-station-icon', bitmap);
  });

  it('falls back to map loading when fetch returns an HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 503, blob: async () => new Blob(),
    })));
    const image = { width: 10 };
    const map = imageMap({ loadedImage: image });

    await expect(loadMapImage(map, 'artifact-station-icon', '/icon.png')).resolves.toBe(true);
    expect(map.addImage).toHaveBeenCalledWith('artifact-station-icon', image);
  });

  it('uses the fetch failure when fallback loading returns no error or image', async () => {
    const fetchError = new Error('fetch failed');
    vi.stubGlobal('fetch', vi.fn(async () => { throw fetchError; }));
    allowConsoleWarn('Failed to load a map icon.', fetchError);
    const map = imageMap();

    await expect(loadMapImage(map, 'biology-station-icon', '/icon.png')).resolves.toBe(false);
  });

  it('reports a failed fallback only once per icon', async () => {
    const fetchError = new Error('fetch failed');
    const loadError = new Error('map failed');
    vi.stubGlobal('fetch', vi.fn(async () => { throw fetchError; }));
    allowConsoleWarn('Failed to load a map icon.', loadError);
    const map = imageMap({ loadError });
    const id: OverlayIconId = 'geology-station-icon';

    await expect(loadMapImage(map, id, '/icon.png')).resolves.toBe(false);
    await expect(loadMapImage(map, id, '/icon.png')).resolves.toBe(false);
  });

  it('loads through an Image element when createImageBitmap is unavailable', async () => {
    const revokeObjectURL = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:test');
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob() })));
    vi.stubGlobal('createImageBitmap', undefined);
    vi.stubGlobal('Image', FakeImage);
    vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURL);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL);
    const map = imageMap();

    await expect(loadMapImage(map, 'cylinder-icon', '/icon.png')).resolves.toBe(true);
    expect(map.addImage).toHaveBeenCalledWith('cylinder-icon', expect.any(FakeImage));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });

  it('revokes the object URL and falls back when an Image element rejects it', async () => {
    const revokeObjectURL = vi.fn();
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onerror?.()); }
    }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob() })));
    vi.stubGlobal('createImageBitmap', undefined);
    vi.stubGlobal('Image', FakeImage);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rejected');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL);
    const fallbackImage = { width: 10 };
    const map = imageMap({ loadedImage: fallbackImage });

    await expect(loadMapImage(map, 'exploration-lead-icon', '/icon.png')).resolves.toBe(true);
    expect(map.addImage).toHaveBeenCalledWith('exploration-lead-icon', fallbackImage);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:rejected');
  });

  it('locks orientation when the map exposes each optional control', () => {
    lockMapOrientation(null);
    const disableRotation = vi.fn();
    const setBearing = vi.fn();
    const setPitch = vi.fn();
    lockMapOrientation({
      getMap: () => ({ touchZoomRotate: { disableRotation }, setBearing, setPitch }),
    } as never);
    expect(disableRotation).toHaveBeenCalledOnce();
    expect(setBearing).toHaveBeenCalledWith(0);
    expect(setPitch).toHaveBeenCalledWith(0);

    expect(() => lockMapOrientation({ getMap: () => ({}) } as never)).not.toThrow();
  });
});
