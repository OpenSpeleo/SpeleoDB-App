import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GpsTrackGpxService } from '../services/GpsTrackGpxService';
import type { GpsTrackStore } from '../services/GpsTrackStore';
import type { ProjectCacheService } from '../services/ProjectCacheService';
import type { SpeleoDBService } from '../services/SpeleoDBService';
import { allowConsoleWarn } from '../test/consoleGuard';
import type { LocalGpsTrack, RemoteGpsTrack } from '../types/gpsTrack';
import { createAbortError } from '../utils/abort';
import type { OfflineMutationCoordinator } from './OfflineMutationCoordinator';
import { GpsTrackCoordinator } from './GpsTrackCoordinator';

const LOCAL: LocalGpsTrack = {
  id: 'local-1',
  name: 'Local',
  color: '#123456',
  points: [{ latitude: 46, longitude: 2, timestamp: 1_000 }],
  createdAt: 1_000,
  updatedAt: 2_000,
};

const REMOTE: RemoteGpsTrack = {
  id: 'remote-1',
  name: 'Remote',
  color: '#654321',
  fileUrl: 'https://files.example/remote.geojson',
  sha256: 'sha',
  createdAt: 3_000,
  updatedAt: 4_000,
};

const GEOJSON: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: [[2, 46], [3, 47]] },
  }],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function createHarness(options: {
  local?: LocalGpsTrack[];
  remote?: RemoteGpsTrack[] | null;
  active?: boolean;
  purging?: boolean;
} = {}) {
  let active = options.active ?? true;
  let purging = options.purging ?? false;
  let now = 10_000;
  let cachedGeoJSON: unknown = null;
  let cachedSha256 = '';
  let cachedRemote = options.remote ?? null;
  const store = {
    list: vi.fn(async () => options.local ?? []),
    put: vi.fn(async (_track: LocalGpsTrack) => {}),
    remove: vi.fn(async (_id: string) => {}),
  };
  const cache = {
    getGpsTracks: vi.fn(async () => cachedRemote),
    setGpsTracks: vi.fn(async (tracks: RemoteGpsTrack[]) => { cachedRemote = tracks; }),
    updateGpsTracks: vi.fn(async (
      updater: (current: RemoteGpsTrack[] | null) => RemoteGpsTrack[],
    ) => {
      cachedRemote = updater(cachedRemote);
      return cachedRemote;
    }),
    removeGpsTrackGeoJSON: vi.fn(async (_id: string) => {}),
    getGpsTrackGeoJSON: vi.fn(async (_id: string) => cachedGeoJSON),
    getGpsTrackGeoJSONRecord: vi.fn(async (_id: string) => (
      cachedGeoJSON === null ? null : { geojson: cachedGeoJSON, sha256: cachedSha256 }
    )),
    setGpsTrackGeoJSON: vi.fn(async (
      _id: string,
      value: GeoJSON.FeatureCollection,
      sha256 = '',
    ) => {
      cachedGeoJSON = value;
      cachedSha256 = sha256;
      return true;
    }),
  };
  const transport = {
    downloadJSON: vi.fn(async (_url: string): Promise<{ status: number; data: unknown }> => ({
      status: 200,
      data: GEOJSON,
    })),
  };
  const gpx = {
    buildFile: vi.fn(async (track: LocalGpsTrack) => ({
      fileName: `${track.name}.gpx`,
      gpx: `<gpx>${track.id}</gpx>`,
    })),
  };
  const mutations = {
    gpsPendingBySubject: vi.fn(() => new Map()),
    foldGpsTracks: vi.fn((tracks: RemoteGpsTrack[]) => [...tracks]),
  };
  const notifyStateChanged = vi.fn();
  const coordinator = new GpsTrackCoordinator({
    store: store as unknown as GpsTrackStore,
    cache: cache as unknown as ProjectCacheService,
    transport: transport as unknown as Pick<SpeleoDBService, 'downloadJSON'>,
    gpx: gpx as unknown as GpsTrackGpxService,
    mutations: mutations as unknown as OfflineMutationCoordinator,
    hasNetworkAccess: () => true,
    isSessionActive: () => active,
    isPurging: () => purging,
    now: () => now,
    notifyStateChanged,
  });
  return {
    cache,
    coordinator,
    gpx,
    mutations,
    notifyStateChanged,
    store,
    transport,
    setActive(value: boolean) { active = value; },
    setCachedGeoJSON(value: unknown, sha256 = REMOTE.sha256) {
      cachedGeoJSON = value;
      cachedSha256 = sha256;
    },
    setNow(value: number) { now = value; },
    setPurging(value: boolean) { purging = value; },
  };
}

describe('GpsTrackCoordinator', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('loads local and remote tracks and builds a newest-first stable snapshot', async () => {
    const { coordinator, notifyStateChanged } = createHarness({ local: [LOCAL], remote: [REMOTE] });
    await coordinator.load();

    expect(coordinator.tracks.map((track) => track.id)).toEqual(['remote-1', 'local-1']);
    expect(coordinator.tracks[1]).toMatchObject({
      origin: 'local',
      pointCount: 1,
      color: '#123456',
    });
    expect(coordinator.revision).toBe(2);
    expect(notifyStateChanged).toHaveBeenCalledTimes(2);
  });

  it('does not publish restored tracks after logout or without an active session', async () => {
    const inactive = createHarness({ local: [LOCAL], remote: [REMOTE], active: false });
    await inactive.coordinator.load();
    expect(inactive.coordinator.tracks).toEqual([]);

    const stale = createHarness();
    const localLoad = deferred<LocalGpsTrack[]>();
    const remoteLoad = deferred<RemoteGpsTrack[] | null>();
    stale.store.list.mockReturnValueOnce(localLoad.promise);
    stale.cache.getGpsTracks.mockReturnValueOnce(remoteLoad.promise);
    const loading = stale.coordinator.load();
    stale.coordinator.resetForLogout();
    localLoad.resolve([LOCAL]);
    remoteLoad.resolve([REMOTE]);
    await loading;
    expect(stale.coordinator.tracks).toEqual([]);
  });

  it('contains load failures and leaves the snapshot unchanged', async () => {
    const localError = new Error('local read failed');
    const remoteError = new Error('remote read failed');
    allowConsoleWarn('Failed to load GPS tracks:', localError);
    allowConsoleWarn('Failed to load cached GPS tracks:', remoteError);
    const harness = createHarness();
    harness.store.list.mockRejectedValueOnce(localError);
    harness.cache.getGpsTracks.mockRejectedValueOnce(remoteError);

    await harness.coordinator.load();
    expect(harness.coordinator.tracks).toEqual([]);
  });

  it('derives pending/folded state and refreshes only on explicit GPS changes', () => {
    const harness = createHarness();
    harness.mutations.gpsPendingBySubject.mockReturnValue(new Map([
      ['local-1', { state: 'create' }],
      ['remote-1', { state: 'error', error: 'failed' }],
    ]));
    harness.coordinator.addCompletedTrack({ ...LOCAL, color: 'invalid' });
    harness.coordinator.publishRemote([REMOTE]);

    expect(harness.coordinator.tracks).toEqual([
      expect.objectContaining({ id: 'remote-1', pending: 'error', pendingError: 'failed' }),
      expect.objectContaining({ id: 'local-1', pending: 'create', color: expect.stringMatching(/^#[0-9a-f]{6}$/) }),
    ]);
    const before = harness.notifyStateChanged.mock.calls.length;
    harness.coordinator.offlineMutationChanged();
    expect(harness.notifyStateChanged).toHaveBeenCalledTimes(before);
    harness.coordinator.recordingStateChanged();
    expect(harness.notifyStateChanged).toHaveBeenCalledTimes(before + 1);
  });

  it('serializes writes and removes a late write invalidated by discard', async () => {
    const first = deferred<void>();
    const harness = createHarness();
    harness.store.put.mockImplementationOnce(async () => first.promise);

    const firstWrite = harness.coordinator.enqueuePersist(LOCAL);
    const secondWrite = harness.coordinator.enqueuePersist({ ...LOCAL, updatedAt: 3_000 });
    expect(harness.store.put).toHaveBeenCalledOnce();
    expect(harness.coordinator.hasPendingPersistence).toBe(true);
    harness.coordinator.invalidatePersistence();
    first.resolve();
    await Promise.all([firstWrite, secondWrite]);
    await harness.coordinator.waitForPersistence();

    expect(harness.store.put).toHaveBeenCalledTimes(2);
    expect(harness.store.remove).toHaveBeenCalledWith('local-1');
    expect(harness.coordinator.hasPendingPersistence).toBe(false);
  });

  it('skips writes outside an active session and reports storage failures', async () => {
    const inactive = createHarness({ active: false });
    await inactive.coordinator.enqueuePersist(LOCAL);
    expect(inactive.store.put).not.toHaveBeenCalled();

    const failure = new Error('write failed');
    const harness = createHarness();
    harness.store.put.mockRejectedValueOnce(failure);

    await expect(harness.coordinator.enqueuePersist(LOCAL)).rejects.toBe(failure);

    expect(harness.coordinator.hasPendingPersistence).toBe(false);
    await expect(harness.coordinator.enqueuePersist({
      ...LOCAL,
      updatedAt: 3_000,
    })).resolves.toBeUndefined();
    expect(harness.store.put).toHaveBeenCalledTimes(2);
  });

  it('updates local tracks and keeps a failed deletion visible', async () => {
    const harness = createHarness({ local: [LOCAL] });
    await harness.coordinator.load();
    harness.setNow(20_000);
    expect(await harness.coordinator.updateLocal('missing', { name: 'x' })).toBeNull();
    const updated = await harness.coordinator.updateLocal('local-1', { name: 'Renamed' });
    expect(updated).toMatchObject({ name: 'Renamed', updatedAt: 20_000 });

    const deleteError = new Error('delete failed');
    harness.store.remove.mockRejectedValueOnce(deleteError);

    await expect(harness.coordinator.removeLocal('local-1')).rejects.toBe(deleteError);

    expect(harness.coordinator.localTrack('local-1')).toMatchObject({ name: 'Renamed' });
    await harness.coordinator.removeLocal('missing');
  });

  it('replaces, upserts, merges, and removes remote ground truth', async () => {
    const harness = createHarness({ remote: [REMOTE] });
    await harness.coordinator.load();
    const parsed = harness.coordinator.mergeRemote('remote-1', {
      name: 'Changed', color: '#abcdef',
    }, { file: 'https://new.example/file', sha256_hash: 'new', modified_date: '2025-01-01' });
    expect(parsed).toMatchObject({
      name: 'Changed', color: '#abcdef', fileUrl: REMOTE.fileUrl, sha256: REMOTE.sha256,
    });
    await harness.coordinator.applyRemoteUpsert(parsed);
    await harness.coordinator.applyRemoteUpsert({ ...REMOTE, id: 'remote-2' });
    await harness.coordinator.applyRemoteRemoval('remote-1');
    expect(harness.cache.removeGpsTrackGeoJSON).toHaveBeenCalledWith('remote-1');
    expect(harness.coordinator.remoteSnapshot('remote-1')).toBeNull();

    harness.setNow(30_000);
    expect(harness.coordinator.mergeRemote('new', { name: 'New', color: '#000000' }, null))
      .toMatchObject({ id: 'new', updatedAt: 30_000, fileUrl: '', sha256: '' });

    const emptyUpsertCache = createHarness();
    await emptyUpsertCache.coordinator.applyRemoteUpsert(REMOTE);
    const emptyRemovalCache = createHarness();
    await emptyRemovalCache.coordinator.applyRemoteRemoval('remote-1');
  });

  it('does not publish a confirmed remote track when its atomic cache commit fails', async () => {
    const storageError = new Error('GPS cache transaction failed');
    const harness = createHarness({ remote: [REMOTE] });
    await harness.coordinator.load();
    harness.cache.updateGpsTracks.mockRejectedValueOnce(storageError);

    await expect(harness.coordinator.applyRemoteUpsert({
      ...REMOTE,
      name: 'Late update',
    })).rejects.toBe(storageError);

    expect(harness.coordinator.remoteSnapshot('remote-1')?.name).toBe('Remote');
  });

  it('builds GPX and points for local and lazily downloaded remote tracks', async () => {
    const harness = createHarness({ local: [LOCAL], remote: [REMOTE] });
    await harness.coordinator.load();
    expect(await harness.coordinator.getPoints('local-1')).toEqual(LOCAL.points);
    expect(await harness.coordinator.getGeoJSON('local-1')).toBeNull();
    expect(await harness.coordinator.buildGpxFile(harness.coordinator.tracks[1]))
      .toEqual({ fileName: 'Local.gpx', gpx: '<gpx>local-1</gpx>' });

    expect(await harness.coordinator.getPoints('remote-1')).toHaveLength(2);
    expect(harness.cache.setGpsTrackGeoJSON).toHaveBeenCalledWith(
      'remote-1',
      GEOJSON,
      REMOTE.sha256,
    );
    expect(await harness.coordinator.buildGpxFile(harness.coordinator.tracks[0]))
      .toEqual({ fileName: 'Remote.gpx', gpx: '<gpx>remote-1</gpx>' });
  });

  it('uses valid cached geometry and rejects unavailable or malformed geometry', async () => {
    const cached = createHarness({ remote: [REMOTE] });
    await cached.coordinator.load();
    cached.setCachedGeoJSON(GEOJSON);
    expect(await cached.coordinator.getGeoJSON('remote-1')).toEqual(GEOJSON);
    expect(cached.transport.downloadJSON).not.toHaveBeenCalled();
    cached.setCachedGeoJSON(null);
    expect(await cached.coordinator.getGeoJSON('missing')).toBeNull();
    expect(await cached.coordinator.getPoints('missing')).toEqual([]);

    cached.setCachedGeoJSON({ nope: true });
    cached.transport.downloadJSON.mockResolvedValueOnce({ status: 404, data: null });
    expect(await cached.coordinator.getGeoJSON('remote-1')).toBeNull();
    cached.transport.downloadJSON.mockResolvedValueOnce({ status: 200, data: 'invalid' });
    expect(await cached.coordinator.getGeoJSON('remote-1')).toBeNull();
  });

  it('rethrows cancellation and contains non-abort geometry download failures', async () => {
    const abort = createHarness({ remote: [REMOTE] });
    await abort.coordinator.load();
    const abortError = createAbortError();
    abort.transport.downloadJSON.mockRejectedValueOnce(abortError);
    await expect(abort.coordinator.getGeoJSON('remote-1')).rejects.toBe(abortError);

    const failure = new Error('download failed');
    allowConsoleWarn('Failed to download GPS track GeoJSON:', failure);
    abort.transport.downloadJSON.mockRejectedValueOnce(failure);
    await expect(abort.coordinator.getGeoJSON('remote-1')).resolves.toBeNull();
  });

  it('eagerly refreshes server geometry when the SHA identity changes', async () => {
    const harness = createHarness({ remote: [REMOTE] });
    await harness.coordinator.load();
    harness.setCachedGeoJSON(GEOJSON, 'old-sha');

    const sources = await harness.coordinator.getPrefetchSources();

    expect(harness.transport.downloadJSON).toHaveBeenCalledWith(REMOTE.fileUrl, {
      signal: undefined,
    });
    expect(harness.cache.setGpsTrackGeoJSON).toHaveBeenCalledWith(
      REMOTE.id,
      GEOJSON,
      REMOTE.sha256,
      { signal: undefined },
    );
    expect(sources).toMatchObject([{
      targetKind: 'gps-track-server',
      targetId: REMOTE.id,
      sourceRevision: REMOTE.sha256,
    }]);
  });

  it('keeps legacy cached server geometry available for ordinary display', async () => {
    const harness = createHarness({ remote: [REMOTE] });
    await harness.coordinator.load();
    harness.setCachedGeoJSON(GEOJSON, '');

    await expect(harness.coordinator.getGeoJSON(REMOTE.id)).resolves.toEqual(GEOJSON);
    expect(harness.transport.downloadJSON).not.toHaveBeenCalled();
  });

  it('fails planning when current server geometry cannot be identified or downloaded', async () => {
    const missingSha = createHarness({ remote: [{ ...REMOTE, sha256: '' }] });
    await missingSha.coordinator.load();
    await expect(missingSha.coordinator.getPrefetchSources()).rejects.toThrow(
      'server SHA unavailable',
    );

    const missingUrl = createHarness({ remote: [{ ...REMOTE, fileUrl: '' }] });
    await missingUrl.coordinator.load();
    await expect(missingUrl.coordinator.getPrefetchSources()).rejects.toThrow(
      'download URL unavailable',
    );
  });
});
