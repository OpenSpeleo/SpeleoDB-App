import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpClient } from '../services/HttpClient';
import { ProjectCacheService } from '../services/ProjectCacheService';
import { SpeleoDBService } from '../services/SpeleoDBService';
import { allowConsoleWarn } from '../test/consoleGuard';
import { CancellationContext } from './CancellationContext';
import { ProjectOverlaySyncCoordinator } from './ProjectOverlaySyncCoordinator';

const EMPTY = { type: 'FeatureCollection', features: [] };
function lead(checked: boolean): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection', features: [{
      type: 'Feature', id: 'lead', geometry: { type: 'Point', coordinates: [2, 46] },
      properties: { description: 'Survey notes', project: 'cave',
        directions: [{ heading: 90, checked }], is_fully_checked: checked },
    }],
  };
}

describe('exploration lead overlay synchronization', () => {
  // The server spans the suite because the real HTTP/SDK boundary is part of this contract.
  let server: Server;
  let instance: string;
  let payload: unknown;
  let requests: string[];
  let online: boolean;
  let cache: ProjectCacheService;
  let coordinator: ProjectOverlaySyncCoordinator;

  beforeAll(async () => {
    server = createServer((request, response) => {
      const url = request.url ?? '';
      requests.push(url);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(url.includes('/exploration-leads/')
        ? payload : url.includes('/landmark-collections/') ? [] : EMPTY));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('HTTP fixture has no TCP address.');
    instance = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  beforeEach(async () => {
    requests = [];
    online = true;
    payload = lead(false);
    cache = new ProjectCacheService();
    await cache.clearAll();
    coordinator = new ProjectOverlaySyncCoordinator({
      cache,
      transport: new SpeleoDBService(new HttpClient({ isNativePlatform: () => false, isProduction: () => false })),
      pendingMutations: () => ({ isReplaying: false, count: 0, load: async () => {} }),
      hasNetworkAccess: () => online,
    });
  });

  it('refreshes checked status on the next overlay sync and retains it offline', async () => {
    await coordinator.sync(new CancellationContext(1, 'test'), instance, 'test-token');
    expect(await cache.getOverlayGeoJSON('explorationLeads')).toEqual(lead(false));
    payload = lead(true);
    await coordinator.sync(new CancellationContext(2, 'test'), instance, 'test-token');
    expect(await new ProjectCacheService().getOverlayGeoJSON('explorationLeads')).toEqual(lead(true));
    const onlineRequests = [...requests];
    online = false;
    expect(await coordinator.sync(new CancellationContext(3, 'test'), instance, 'test-token'))
      .toMatchObject({ status: 'skipped', reason: 'offline_locked' });
    expect(requests).toEqual(onlineRequests);
    expect(await cache.getOverlayGeoJSONForOfflineMap('explorationLeads')).toEqual(lead(true));
  });

  it.each([
    { directions: [{ heading: 90, checked: 'false' }], is_fully_checked: false },
    { directions: [], is_fully_checked: true },
    { directions: [{ heading: 90, checked: true }], is_fully_checked: false },
    { headings: [90] },
  ])('preserves the last valid overlay when the live contract is invalid: %j', async (properties) => {
    await cache.setOverlayGeoJSON('explorationLeads', lead(true));
    payload = { type: 'FeatureCollection', features: [{
      type: 'Feature', geometry: { type: 'Point', coordinates: [2, 46] }, properties,
    }] };
    allowConsoleWarn('Overlay sync skipped for explorationLeads: malformed 2xx payload');
    expect(await coordinator.sync(new CancellationContext(1, 'test'), instance, 'test-token'))
      .toMatchObject({ status: 'failed', failedOverlayCount: 1 });
    expect(await cache.getOverlayGeoJSON('explorationLeads')).toEqual(lead(true));
  });
});
