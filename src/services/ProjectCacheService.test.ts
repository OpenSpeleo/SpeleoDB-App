import { beforeEach, describe, expect, it } from 'vitest';
import { ProjectCacheService } from './ProjectCacheService';

describe('ProjectCacheService overlay cache', () => {
  let cache: ProjectCacheService;

  beforeEach(async () => {
    cache = new ProjectCacheService();
    await cache.clearAll();
  });

  it('stores and reads namespaced overlay geojson entries', async () => {
    const overlayPayload: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Landmark A' },
          geometry: { type: 'Point', coordinates: [2.3, 46.6] },
        },
      ],
    };

    await cache.setOverlayGeoJSON('landmarks', overlayPayload);

    const fromCache = await cache.getOverlayGeoJSON('landmarks');
    expect(fromCache).toEqual(overlayPayload);
  });

  it('keeps overlay and project geojson cache entries independent', async () => {
    const projectGeoJson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [],
    };
    const overlayGeoJson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { type: 'sensor' },
          geometry: { type: 'Point', coordinates: [1, 1] },
        },
      ],
    };

    await cache.setGeoJSON('project-1', projectGeoJson, 'commit-1');
    await cache.setOverlayGeoJSON('subsurfaceStations', overlayGeoJson);

    expect(await cache.getGeoJSON('project-1')).toEqual(projectGeoJson);
    expect(await cache.getOverlayGeoJSON('subsurfaceStations')).toEqual(overlayGeoJson);
    expect(await cache.getCachedCommitId('project-1')).toBe('commit-1');
  });

  it('clears overlay geojson cache entries on clearAll', async () => {
    await cache.setOverlayGeoJSON('explorationLeads', {
      type: 'FeatureCollection',
      features: [],
    });

    await cache.clearAll();

    expect(await cache.getOverlayGeoJSON('explorationLeads')).toBeNull();
  });

  it('throws AbortError instead of swallowing cancelled writes', async () => {
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      cache.setProjects([], { signal: abortController.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('stores and reads the server GPS-track metadata list', async () => {
    const tracks = [
      { id: 'g1', name: 'A', color: '#377eb8', fileUrl: 'u1', sha256: 'h1', createdAt: 1, updatedAt: 1 },
      { id: 'g2', name: 'B', color: '#e41a1c', fileUrl: 'u2', sha256: 'h2', createdAt: 2, updatedAt: 2 },
    ];
    expect(await cache.getGpsTracks()).toBeNull();
    await cache.setGpsTracks(tracks);
    expect(await cache.getGpsTracks()).toEqual(tracks);
  });

  it('stores, reads and removes per-track GeoJSON geometry independently', async () => {
    const geo: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }],
    };
    await cache.setGpsTrackGeoJSON('g1', geo);
    expect(await cache.getGpsTrackGeoJSON('g1')).toEqual(geo);
    expect(await cache.getGpsTrackGeoJSON('g2')).toBeNull();
    await cache.removeGpsTrackGeoJSON('g1');
    expect(await cache.getGpsTrackGeoJSON('g1')).toBeNull();
  });

  it('clears GPS track caches on clearAll', async () => {
    await cache.setGpsTracks([{ id: 'g1', name: 'A', color: '#377eb8', fileUrl: 'u', sha256: 'h', createdAt: 1, updatedAt: 1 }]);
    await cache.setGpsTrackGeoJSON('g1', { type: 'FeatureCollection', features: [] });
    await cache.clearAll();
    expect(await cache.getGpsTracks()).toBeNull();
    expect(await cache.getGpsTrackGeoJSON('g1')).toBeNull();
  });
});
