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
});
