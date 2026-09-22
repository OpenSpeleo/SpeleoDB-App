import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheStore } from '../services/CacheStore';
import { ProjectCacheService } from '../services/ProjectCacheService';
import type { SpeleoDBService } from '../services/SpeleoDBService';
import type { Project } from '../types/project';
import { allowConsoleError, allowConsoleWarn } from '../test/consoleGuard';
import { measureProjectGeoJSONBounds } from '../utils/projectGeoJSONBounds';
import { ProjectGeoJSONAnalysisError } from '../services/ProjectGeoJSONAnalyzer';
import { CancellationContext } from './CancellationContext';
import { ProjectGeoJSONCoordinator } from './ProjectGeoJSONCoordinator';

const oldData: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection', features: [{ type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: [[2, 45], [2.001, 45.001]] } }],
};
const newData: GeoJSON.FeatureCollection = {
  ...oldData, features: [{ ...oldData.features[0], properties: { color: '#112233' } }],
};
const analysis = { ...measureProjectGeoJSONBounds(oldData), durationMs: 1 };
const diagnostics = { bounds: null, widthKm: null, heightKm: null, durationMs: null };

function project(revision?: string | null, commitId = 'commit'): Project {
  return {
    id: 'cave', name: 'Cave', color: '#abcdef', country: 'US', description: '',
    type: 'COMPASS', visibility: 'PRIVATE', is_active: true, created_by: 'owner',
    creation_date: '', modified_date: '', commit_count: 1, active_mutex: null, fork_from: null,
    exclude_geojson: false, geojson_file: 'https://test.invalid/file?signature=one',
    geojson_revision: revision,
    latest_commit: { id: commitId, message: '', author_email: '', author_name: '', authored_date: '',
      dt_since: '', parent_ids: [], url: '', formats: [], tree: [] },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { resolve, promise };
}
function setup(cache = new ProjectCacheService()) {
  const download = vi.fn(async () => ({ status: 200, data: newData as unknown }));
  const analyze = vi.fn(async (data: GeoJSON.FeatureCollection) => ({
    ...measureProjectGeoJSONBounds(data), durationMs: 1,
  }));
  const removePrefetchTarget = vi.fn(async () => {});
  const coordinator = new ProjectGeoJSONCoordinator({ cache,
    transport: { downloadJSON: download } as unknown as SpeleoDBService,
    analyzer: { analyze }, hasNetworkAccess: () => true,
    removePrefetchTarget, notifyStateChanged: vi.fn(),
  });
  return { coordinator, cache, download, analyze, removePrefetchTarget };
}
async function seed(cache: ProjectCacheService, revision?: string) {
  await cache.setValidatedProjectGeoJSON('cave', oldData, 'commit', analysis, { geojsonRevision: revision });
}
function warning(reason = 'invalid_geojson', source = 'computed') {
  allowConsoleWarn('[project-geojson:bbox]', expect.objectContaining({ projectId: 'cave', reason, source }));
}

beforeEach(async () => { await new ProjectCacheService().clearAll(); });

describe('GeoJSON artifact refresh through durable cache', () => {
  it('uses legacy validated bytes offline and does not relabel their artifact revision', async () => {
    const { cache, coordinator, download, analyze } = setup();
    await seed(cache);
    const p = project('new');
    await coordinator.sync(new CancellationContext(1, 'test'), [p], false);
    expect(await coordinator.getMapData([p], p.id)).toMatchObject({ featureCollection: oldData });
    expect((await cache.getProjectGeoJSONRecord('cave'))).not.toHaveProperty('geojsonRevision');
    expect(download).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
  });

  it('audits legacy bytes offline without stamping the advertised revision', async () => {
    const { cache, coordinator, download } = setup();
    await cache.setGeoJSON('cave', oldData, 'commit');
    await coordinator.sync(new CancellationContext(1, 'test'), [project('new')], false);
    expect(await cache.getProjectGeoJSONRecord('cave')).toMatchObject({ state: 'active', data: oldData });
    expect(await cache.getProjectGeoJSONRecord('cave')).not.toHaveProperty('geojsonRevision');
    expect(download).not.toHaveBeenCalled();
    await coordinator.sync(new CancellationContext(2, 'test'), [project('new')], true);
    expect(download).toHaveBeenCalledOnce();
  });

  it('keeps cached map reads independent of pending replacement download and persists success', async () => {
    const { cache, coordinator, download } = setup();
    await seed(cache, 'old');
    const pending = deferred<{ status: number; data: unknown }>();
    download.mockImplementationOnce(() => pending.promise);
    const p = project('new');
    const sync = coordinator.sync(new CancellationContext(1, 'test'), [p], true);
    await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
    expect(await coordinator.getMapData([p], p.id)).toMatchObject({ featureCollection: oldData, geojsonRevision: 'old' });
    pending.resolve({ status: 200, data: newData });
    await sync;
    const restarted = setup();
    expect(await restarted.coordinator.getMapData([p], p.id)).toMatchObject({ featureCollection: newData, geojsonRevision: 'new' });
    await restarted.coordinator.sync(new CancellationContext(2, 'test'), [{ ...p, geojson_file: 'https://test.invalid/file?signature=two' }], true);
    expect(restarted.download).not.toHaveBeenCalled();
  });

  it('keeps commit-only behavior for older servers without revisions', async () => {
    const { cache, coordinator, download } = setup();
    await seed(cache, 'old');
    await coordinator.sync(new CancellationContext(1, 'test'), [project()], true);
    expect(download).not.toHaveBeenCalled();
  });

  it('preserves valid geometry on network failure and retries later', async () => {
    const { cache, coordinator, download } = setup();
    await seed(cache, 'old');
    download.mockResolvedValueOnce({ status: 503, data: null });
    allowConsoleWarn('Skipping project GeoJSON cache: status 503');
    await coordinator.sync(new CancellationContext(1, 'test'), [project('new')], true);
    expect(await coordinator.getMapData([project('new')], 'cave')).toMatchObject({ featureCollection: oldData });
    await coordinator.sync(new CancellationContext(2, 'test'), [project('new')], true);
    expect(download).toHaveBeenCalledTimes(2);
  });

  it('retains safe geometry and revision-specific rejection across restart and acknowledgement', async () => {
    const { cache, coordinator, download, removePrefetchTarget } = setup();
    await seed(cache, 'old');
    download.mockResolvedValueOnce({ status: 200, data: {} });
    warning();
    await coordinator.sync(new CancellationContext(1, 'test'), [project('bad')], true);
    expect(removePrefetchTarget).not.toHaveBeenCalled();
    expect(await coordinator.getMapData([project('bad')], 'cave')).toMatchObject({ featureCollection: oldData });
    expect(coordinator.warnings).toEqual([expect.objectContaining({ geojsonRevision: 'bad', persistent: true })]);
    const restarted = setup();
    warning('invalid_geojson', 'cache');
    await restarted.coordinator.sync(new CancellationContext(2, 'test'), [project('bad')], true);
    expect(restarted.download).not.toHaveBeenCalled();
    expect(await restarted.coordinator.acknowledgeWarnings()).toEqual({ acknowledgedCount: 1, failedCount: 0 });
    const acknowledged = setup();
    warning('invalid_geojson', 'cache');
    await acknowledged.coordinator.sync(new CancellationContext(3, 'test'), [project('bad')], true);
    expect(acknowledged.coordinator.warnings).toEqual([]);
    expect(acknowledged.download).not.toHaveBeenCalled();
    await acknowledged.coordinator.sync(new CancellationContext(4, 'test'), [project('fixed')], true);
    expect(acknowledged.download).toHaveBeenCalledOnce();
    expect(await acknowledged.cache.getProjectGeoJSONRecord('cave')).toMatchObject({ state: 'active', geojsonRevision: 'fixed', data: newData });
    expect(await acknowledged.cache.getProjectGeoJSONRecord('cave')).not.toHaveProperty('rejectedReplacement');
  });

  it('keeps fallback usable when a replacement analyzer fails transiently', async () => {
    const { cache, coordinator, analyze, removePrefetchTarget } = setup();
    await seed(cache, 'old');
    analyze.mockRejectedValueOnce(new ProjectGeoJSONAnalysisError('validation_unavailable', 'worker unavailable', false));
    warning('validation_unavailable');
    await coordinator.sync(new CancellationContext(1, 'test'), [project('new')], true);
    expect(await coordinator.getMapData([project('new')], 'cave')).toMatchObject({ featureCollection: oldData });
    expect(removePrefetchTarget).not.toHaveBeenCalled();
    expect(coordinator.warnings[0]).toMatchObject({ persistent: false, geojsonRevision: 'new' });
    warning('validation_unavailable', 'cache');
    await coordinator.sync(new CancellationContext(2, 'test'), [project('new')], true);
    expect(analyze).toHaveBeenCalledOnce();
  });

  it('recovers a same-commit quarantine when the artifact revision changes', async () => {
    const { coordinator, download } = setup();
    download.mockResolvedValueOnce({ status: 200, data: {} });
    warning();
    await coordinator.sync(new CancellationContext(1, 'test'), [project('bad')], true);
    expect(await coordinator.getMapData([project('bad')], 'cave')).toBeNull();
    await coordinator.sync(new CancellationContext(2, 'test'), [project('fixed')], true);
    expect(await coordinator.getMapData([project('fixed')], 'cave')).toMatchObject({ featureCollection: newData });
    expect(coordinator.warnings).toEqual([]);
  });

  it('keeps changed source commits fail-closed even when replacement download is pending', async () => {
    const { cache, coordinator } = setup();
    await seed(cache, 'old');
    expect(await coordinator.getMapData([project('new', 'different-commit')], 'cave')).toBeNull();
  });

  it('never publishes a cancelled artifact after a newer sync succeeds', async () => {
    const { cache, coordinator, download } = setup();
    await seed(cache, 'old');
    const pending = deferred<{ status: number; data: unknown }>();
    download.mockImplementationOnce(() => pending.promise);
    const first = new CancellationContext(1, 'test');
    const staleSync = coordinator.sync(first, [project('stale')], true);
    await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
    first.abort();
    await coordinator.sync(new CancellationContext(2, 'test'), [project('new')], true);
    const rejected = expect(staleSync).rejects.toMatchObject({ name: 'AbortError' });
    pending.resolve({ status: 200, data: oldData });
    await rejected;
    expect(await new ProjectCacheService().getProjectGeoJSONRecord('cave')).toMatchObject({ geojsonRevision: 'new', data: newData });
  });

  it('acknowledges only the exact rejected revision under concurrent cache updates', async () => {
    const cache = new ProjectCacheService();
    await seed(cache, 'old');
    const reject = (geojsonRevision: string) => cache.rejectProjectGeoJSONReplacement('cave', 'commit', {
      geojsonRevision, reason: 'invalid_geojson', diagnostics, warningAcknowledged: false,
    });
    await reject('bad-1');
    const updated = reject('bad-2');
    const staleAck = cache.acknowledgeProjectGeoJSONQuarantine('cave', 'commit', { geojsonRevision: 'bad-1' });
    expect(await updated).toBe(true);
    expect(await staleAck).toBe(false);
    expect(await cache.getProjectGeoJSONRecord('cave')).toMatchObject({ rejectedReplacement: { geojsonRevision: 'bad-2', warningAcknowledged: false } });
    expect(await cache.acknowledgeProjectGeoJSONQuarantine('cave', 'commit', { geojsonRevision: 'bad-2' })).toBe(true);
    await cache.setValidatedProjectGeoJSON('cave', newData, 'commit', analysis, { geojsonRevision: 'bad-2' });
    expect(await reject('bad-2')).toBe(false);
    expect(await cache.acknowledgeProjectGeoJSONQuarantine('cave', 'commit', { geojsonRevision: 'bad-2' })).toBe(false);
  });

  it('keeps fallback bytes and session rejection when rejection persistence fails', async () => {
    const store = new CacheStore();
    const { cache, coordinator, download, removePrefetchTarget } = setup(new ProjectCacheService(store));
    await seed(cache, 'old');
    vi.spyOn(store, 'update').mockRejectedValueOnce(new Error('storage unavailable'));
    download.mockResolvedValueOnce({ status: 200, data: {} });
    allowConsoleError('ProjectCacheService.rejectProjectGeoJSONReplacement failed:', expect.any(Error));
    warning();
    allowConsoleWarn('[project-geojson:quarantine-persistence-failed]', expect.objectContaining({ projectId: 'cave' }));
    await coordinator.sync(new CancellationContext(1, 'test'), [project('bad')], true);
    expect(await coordinator.getMapData([project('bad')], 'cave')).toMatchObject({ featureCollection: oldData });
    expect(coordinator.warnings[0].persistent).toBe(false);
    expect(removePrefetchTarget).not.toHaveBeenCalled();
  });

  it('preserves durable fallback when a valid replacement cannot be committed', async () => {
    const store = new CacheStore();
    const { cache, coordinator, removePrefetchTarget } = setup(new ProjectCacheService(store));
    await seed(cache, 'old');
    vi.spyOn(store, 'set').mockRejectedValueOnce(new Error('disk full'));
    allowConsoleError('ProjectCacheService.setValidatedProjectGeoJSON failed:', expect.any(Error));
    warning('validation_unavailable');
    await coordinator.sync(new CancellationContext(1, 'test'), [project('new')], true);
    expect(await coordinator.getMapData([project('new')], 'cave')).toMatchObject({ featureCollection: oldData, geojsonRevision: 'old' });
    expect(await new ProjectCacheService().getProjectGeoJSONRecord('cave')).toMatchObject({ state: 'active', data: oldData, geojsonRevision: 'old' });
    expect(removePrefetchTarget).not.toHaveBeenCalled();
  });

  it('does not acknowledge a newer full quarantine from the same source commit', async () => {
    const cache = new ProjectCacheService();
    await cache.setQuarantinedProjectGeoJSON('cave', 'commit', 'invalid_geojson', diagnostics, { geojsonRevision: 'bad-2' });
    expect(await cache.acknowledgeProjectGeoJSONQuarantine('cave', 'commit', { geojsonRevision: 'bad-1' })).toBe(false);
    expect(await cache.getProjectGeoJSONRecord('cave')).toMatchObject({ geojsonRevision: 'bad-2', warningAcknowledged: false });
    expect(await cache.acknowledgeProjectGeoJSONQuarantine('cave', 'commit', { geojsonRevision: 'bad-2' })).toBe(true);
    expect(await cache.getProjectGeoJSONRecord('cave')).toMatchObject({ warningAcknowledged: true });
  });

  it('acknowledges the stored artifact when an older server omits its revision', async () => {
    const { cache, coordinator, download } = setup();
    await cache.setQuarantinedProjectGeoJSON('cave', 'commit', 'invalid_geojson', diagnostics, { geojsonRevision: 'bad' });
    warning('invalid_geojson', 'cache');
    await coordinator.sync(new CancellationContext(1, 'test'), [project()], true);
    expect(coordinator.warnings).toEqual([expect.objectContaining({ geojsonRevision: 'bad' })]);
    const warnings = coordinator.warnings;
    warning('invalid_geojson', 'cache');
    await coordinator.sync(new CancellationContext(2, 'test'), [project()], true);
    expect(coordinator.warnings).toBe(warnings);
    expect(await coordinator.acknowledgeWarnings()).toEqual({ acknowledgedCount: 1, failedCount: 0 });
    expect(await new ProjectCacheService().getProjectGeoJSONRecord('cave')).toMatchObject({ geojsonRevision: 'bad', warningAcknowledged: true });
    expect(download).not.toHaveBeenCalled();
  });

  it.each(['active', 'quarantined', 'rejected', 'acknowledged'] as const)(
    'reloads durable %s metadata when cancellation arrives just after commit', async (operation) => {
      const store = new CacheStore();
      const cache = new ProjectCacheService(store);
      await seed(cache, 'old');
      const rejection = {
        geojsonRevision: 'new', reason: 'invalid_geojson' as const,
        diagnostics, warningAcknowledged: false,
      };
      if (operation === 'acknowledged') {
        await cache.rejectProjectGeoJSONReplacement('cave', 'commit', rejection);
      }
      const before = await cache.getProjectGeoJSONRecord('cave');
      const cancellation = new AbortController();
      const options = { geojsonRevision: 'new', signal: cancellation.signal };
      if (operation === 'active' || operation === 'quarantined') {
        const originalSet = store.set.bind(store);
        vi.spyOn(store, 'set').mockImplementationOnce(async (...args) => {
          await originalSet(...args);
          cancellation.abort();
        });
      } else {
        const originalUpdate = store.update.bind(store);
        vi.spyOn(store, 'update').mockImplementationOnce(async (...args) => {
          const updated = await originalUpdate(...args);
          cancellation.abort();
          return updated;
        });
      }
      const write = operation === 'active'
        ? cache.setValidatedProjectGeoJSON('cave', newData, 'commit', analysis, options)
        : operation === 'quarantined'
          ? cache.setQuarantinedProjectGeoJSON('cave', 'commit', 'invalid_geojson', diagnostics, options)
          : operation === 'rejected'
            ? cache.rejectProjectGeoJSONReplacement('cave', 'commit', rejection, options)
            : cache.acknowledgeProjectGeoJSONQuarantine('cave', 'commit', options);
      await expect(write).rejects.toMatchObject({ name: 'AbortError' });
      const durable = await new ProjectCacheService().getProjectGeoJSONRecord('cave');
      expect(durable).not.toEqual(before);
      expect(await cache.getProjectGeoJSONRecord('cave')).toEqual(durable);
    },
  );
});
