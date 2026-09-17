import { describe, expect, it } from 'vitest';
import { DownloadAreaType, type DownloadArea } from '../types/downloadArea';
import {
  areaBounds,
  areaFeatureCollection,
  boundsForCoordinates,
  cornersForBounds,
  countAreaCoordinates,
  MAX_AREA_COORDINATES,
  parseDownloadAreaCatalog,
  validAreaCorners,
} from './downloadAreaGeometry';
import { buildTileUrlsForProjectBounds } from './tilePrefetchPlanner';
import { automaticAreaInputs } from './downloadAreaSources';
import { WEB_MERCATOR_MAX_LATITUDE } from '../utils/geographicBounds';

function area(overrides: Partial<DownloadArea> = {}): DownloadArea {
  return {
    areaId: 'area-1',
    objectId: null,
    type: DownloadAreaType.Manual,
    name: 'Camp',
    visible: true,
    sourceKey: 'manual:area-1',
    sourceRevision: null,
    revision: 1,
    layerIds: ['esri-satellite'],
    topLeft: [2.00001, 46.00002],
    bottomRight: [2.00002, 46.00001],
    ...overrides,
  };
}
describe('download area geometry and validation', () => {
  it.each([
    area(),
    area({ topLeft: [179.9999, 1.0001], bottomRight: [-179.9999, 1] }),
    area({ topLeft: [-180, 0.0001], bottomRight: [-179.9999, 0] }),
    area({ topLeft: [2, 85.051], bottomRight: [2.0001, 85.0509] }),
  ])(
    'preflight matches the actual bounded rectangle planner, including wrapped root tiles',
    (value) => {
      const urls = buildTileUrlsForProjectBounds(areaBounds(value), {
        minZoom: 0,
        maxZoom: 18,
        padMeters: 0,
        tileUrlTemplate: '{z}/{x}/{y}',
      });
      expect(countAreaCoordinates(value)).toBe(urls.length);
      expect(new Set(urls.map((url) => Number(url.split('/')[0])))).toEqual(
        new Set(Array.from({ length: 19 }, (_, i) => i)),
      );
    },
  );
  it('counts world-scale selections before allocating any tile collection', () => {
    expect(
      countAreaCoordinates({ topLeft: [-180, 85], bottomRight: [180, -85] }),
    ).toBeGreaterThan(MAX_AREA_COORDINATES);
  });
  it('rejects invalid coordinates, inverted latitude, and zero size', () => {
    expect(validAreaCorners([NaN, 1], [1, 0])).toBe(false);
    expect(validAreaCorners([2, 0], [1, 1])).toBe(false);
    expect(validAreaCorners([1, 1], [1, 0])).toBe(false);
    expect(validAreaCorners([1, 89], [2, 88])).toBe(false);
    expect(() =>
      countAreaCoordinates({ topLeft: [1, 1], bottomRight: [1, 0] }),
    ).toThrow();
  });
  it('renders every manual rectangle and splits a dateline rectangle', () => {
    const collection = areaFeatureCollection([
      area(),
      area({ areaId: 'hidden', visible: false }),
      area({ areaId: 'auto', type: DownloadAreaType.Project }),
      area({ areaId: 'wrapped', topLeft: [179, 10], bottomRight: [-179, 9] }),
    ]);
    expect(collection.features.map((feature) => feature.id)).toEqual([
      'area-1',
      'hidden',
      'wrapped',
    ]);
    expect(collection.features[2].geometry).toEqual({
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [179, 10],
            [180, 10],
            [180, 9],
            [179, 9],
            [179, 10],
          ],
        ],
        [
          [
            [-180, 10],
            [-179, 10],
            [-179, 9],
            [-180, 9],
            [-180, 10],
          ],
        ],
      ],
    });
  });
  it('validates the whole JSON record without treating corruption as empty intent', () => {
    expect(parseDownloadAreaCatalog(undefined).areas).toEqual([]);
    expect(
      parseDownloadAreaCatalog({
        schemaVersion: 1,
        revision: 0,
        areas: [area()],
      }).areas,
    ).toHaveLength(1);
    for (const bad of [
      null,
      {},
      { schemaVersion: 2 },
      { schemaVersion: 1, revision: 0, areas: [area({ color: 'not-a-color' })] },
      { schemaVersion: 1, revision: 0, areas: [area(), area()] },
      {
        schemaVersion: 1,
        revision: 0,
        areas: [area({ type: DownloadAreaType.Project })],
      },
    ])
      expect(() => parseDownloadAreaCatalog(bad)).toThrow();
  });
  it('pads points and preserves the short antimeridian interval', () => {
    const bounds = boundsForCoordinates([
      [179.99, 10],
      [-179.99, 10.01],
    ])!;
    expect(bounds.crossesDateline).toBe(true);
    const corners = cornersForBounds(bounds, 50);
    expect(corners.topLeft[0]).toBeGreaterThan(179.9);
    expect(corners.bottomRight[0]).toBeLessThan(-179.9);
    expect(corners.topLeft[1]).toBeGreaterThan(10.01);
    expect(
      boundsForCoordinates([
        [Infinity, 0],
        [0, 91],
      ]),
    ).toBeNull();
  });
  it.each([86, 90, -86, -90])('keeps padded source bounds valid at latitude %s', (latitude) => {
    const corners = cornersForBounds({
      west: 2,
      east: 2,
      south: latitude,
      north: latitude,
      crossesDateline: false,
    }, 50);
    expect(validAreaCorners(corners.topLeft, corners.bottomRight)).toBe(true);
    expect(latitude > 0 ? corners.topLeft[1] : corners.bottomRight[1])
      .toBe(Math.sign(latitude) * WEB_MERCATOR_MAX_LATITUDE);
    const urls = buildTileUrlsForProjectBounds(areaBounds(corners), {
      minZoom: 0,
      maxZoom: 18,
      padMeters: 0,
      tileUrlTemplate: '{z}/{x}/{y}',
    });
    expect(countAreaCoordinates(corners)).toBe(urls.length);
  });
});
describe('source adapters feed one rectangular area model', () => {
  it('preserves GIS min/max bounds, pads flat lines, and bounds only the catalog label', () => {
    const sources = automaticAreaInputs([], [], [], ['esri-satellite'], [{
      id: 'geometry-1',
      name: `  ${'A'.repeat(255)}  `,
      color: '#377eb8',
      sourceRevision: '4',
      // A valid line may traverse this interval through intermediate vertices.
      bounds: { west: -170, east: 170, south: 20, north: 20, crossesDateline: false },
    }]);
    expect(sources).toHaveLength(1);
    const source = sources[0];
    expect(source).toMatchObject({
      type: DownloadAreaType.GisGeometry,
      objectId: 'geometry-1',
      sourceKey: 'gis-geometry:geometry-1',
      sourceRevision: '4',
      color: '#377eb8',
      name: 'A'.repeat(120),
      visible: false,
    });
    expect(source.topLeft[0]).toBeLessThan(-170);
    expect(source.bottomRight[0]).toBeGreaterThan(170);
    expect(source.topLeft[1]).toBeGreaterThan(20);
    expect(source.bottomRight[1]).toBeLessThan(20);
    expect(areaBounds(source).crossesDateline).toBe(false);
    expect(parseDownloadAreaCatalog({
      schemaVersion: 1,
      revision: 1,
      areas: [{ ...source, areaId: 'area-geometry', revision: 1 }],
    }).areas[0].type).toBe(DownloadAreaType.GisGeometry);
  });

  it('includes projects, each point overlay, and exactly one rectangle for an entire track', () => {
    const inputs = automaticAreaInputs(
      [
        {
          projectId: 'p',
          commitId: 'sha',
          bounds: {
            west: 1,
            east: 2,
            south: 3,
            north: 4,
            crossesDateline: false,
          },
        },
      ],
      (
        [
          'landmarks',
          'surfaceStations',
          'subsurfaceStations',
          'explorationLeads',
          'cylinderInstalls',
        ] as const
      ).map((id) => ({
        id,
        collection: {
          type: 'FeatureCollection' as const,
          features: [
            {
              type: 'Feature' as const,
              id: `${id}-id`,
              properties: { name: 'Point' },
              geometry: { type: 'Point' as const, coordinates: [2, 46] },
            },
          ],
        },
      })),
      [
        {
          targetKind: 'gps-track-local',
          targetId: 'track',
          sourceRevision: 'v1',
          paths: [
            [
              [1, 1],
              [2, 4],
            ],
            [
              [4, 5],
              [8, 9],
            ],
          ],
        },
      ],
      ['esri-satellite'],
    );
    expect(inputs).toHaveLength(7);
    expect(inputs.every((value) => !value.visible)).toBe(true);
    const track = inputs.find(
      (value) => value.type === DownloadAreaType.Track,
    )!;
    expect(track.objectId).toBe('track');
    expect(track.topLeft[0]).toBeLessThan(1);
    expect(track.topLeft[1]).toBeGreaterThan(9);
    expect(track.bottomRight[0]).toBeGreaterThan(8);
    expect(track.bottomRight[1]).toBeLessThan(1);
    expect(inputs.map((input) => input.type)).toEqual(
      expect.arrayContaining([
        DownloadAreaType.Landmark,
        DownloadAreaType.ExplorationLead,
        DownloadAreaType.CylinderInstall,
      ]),
    );
  });
});
