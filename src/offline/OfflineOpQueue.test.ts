import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  OfflineOpPersistenceError,
  OfflineOpQueue,
  type OfflineReplayPort,
} from './OfflineOpQueue';
import { OfflineOpStore } from './OfflineOpStore';
import { snapshotFromApi } from './landmarkSnapshot';
import type { LandmarkApiObject } from '../types/landmark';
import type { LandmarkSnapshot, SerializedOfflineOp } from '../types/offlineOp';
import type { GpsTrackSnapshot, RemoteGpsTrack } from '../types/gpsTrack';

// ---- Fakes ----------------------------------------------------------------

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createMemoryStore() {
  const records = new Map<string, SerializedOfflineOp>();
  const store = {
    list: vi.fn(async () => [...records.values()].sort((a, b) => a.seq - b.seq)),
    put: vi.fn(async (op: SerializedOfflineOp) => {
      records.set(op.id, op);
      return true;
    }),
    remove: vi.fn(async (id: string) => {
      records.delete(id);
      return true;
    }),
    replace: vi.fn(async (removedId: string, op: SerializedOfflineOp) => {
      records.delete(removedId);
      records.set(op.id, op);
      return true;
    }),
    clear: vi.fn(async () => {
      records.clear();
    }),
  };
  return { store: store as unknown as OfflineOpStore, records };
}

function fc(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features };
}

function landmarkFeature(
  id: string,
  props: Partial<{ name: string; description: string; collection: string }>,
  lon: number,
  lat: number,
): GeoJSON.Feature {
  return {
    type: 'Feature',
    id,
    properties: {
      id,
      name: props.name ?? '',
      description: props.description ?? '',
      collection: props.collection ?? '',
      can_write: true,
      can_delete: true,
    },
    geometry: { type: 'Point', coordinates: [lon, lat] },
  };
}

const SERVER_LANDMARK: LandmarkApiObject = {
  id: 'lm-1',
  name: 'Camp',
  description: 'Base',
  latitude: 45.5,
  longitude: -122.25,
  collection: 'col-1',
  collection_name: 'Survey A',
  collection_color: '#3b82f6',
  is_personal_collection: false,
  can_write: true,
  can_delete: true,
};

function baselineSnapshot(): LandmarkSnapshot {
  return snapshotFromApi(SERVER_LANDMARK);
}

function createPort(overrides: Partial<OfflineReplayPort> = {}): OfflineReplayPort {
  return {
    hasNetworkAccess: () => true,
    postLandmark: vi.fn(async () => ({ status: 201, data: { landmark: SERVER_LANDMARK } })),
    patchLandmark: vi.fn(async () => ({ status: 200, data: { landmark: SERVER_LANDMARK } })),
    deleteLandmark: vi.fn(async () => ({ status: 200, data: { message: 'deleted' } })),
    fetchLandmarksGeoJSON: vi.fn(async () => ({ status: 200, data: fc([]) })),
    applyUpsert: vi.fn(async () => {}),
    applyRemoval: vi.fn(async () => {}),
    uploadGpsTrack: vi.fn(async () => ({ status: 200, data: { gps_tracks_created: 1 } })),
    patchGpsTrack: vi.fn(async () => ({ status: 200, data: {} })),
    deleteGpsTrackRemote: vi.fn(async () => ({ status: 200, data: { message: 'deleted' } })),
    fetchGpsTracks: vi.fn(async () => ({ status: 200, data: [] })),
    applyGpsTrackUpsert: vi.fn(async () => {}),
    applyGpsTrackRemoval: vi.fn(async () => {}),
    onGpsTrackCreated: vi.fn(async () => {}),
    ...overrides,
  };
}

function optimisticCreate(id = 'local:new'): LandmarkApiObject {
  return {
    id,
    name: 'New Camp',
    description: '',
    latitude: 10,
    longitude: 20,
    collection: '',
    collection_name: 'Personal Landmarks',
    collection_color: '',
    is_personal_collection: true,
    can_write: true,
    can_delete: true,
  };
}

// ---- Tests ----------------------------------------------------------------

describe('OfflineOpQueue fold + coalescing', () => {
  let store: OfflineOpStore;

  beforeEach(() => {
    ({ store } = createMemoryStore());
  });

  it('folds a pending create over the base collection', async () => {
    const queue = new OfflineOpQueue(store, createPort());
    await queue.enqueueCreate(optimisticCreate());
    const folded = queue.foldOver(fc([]));
    expect(folded.features.map((f) => f.properties?.name)).toContain('New Camp');
    expect(queue.count).toBe(1);
  });

  it('coalesces an edit of a not-yet-synced create into the create', async () => {
    const queue = new OfflineOpQueue(store, createPort());
    await queue.enqueueCreate(optimisticCreate('local:x'));
    await queue.enqueueUpdate('local:x', baselineSnapshot(), {
      name: 'Renamed',
      description: '',
      latitude: 10,
      longitude: 20,
      collection: null,
    });
    expect(queue.count).toBe(1);
    expect(queue.foldOver(fc([])).features[0].properties?.name).toBe('Renamed');
  });

  it('drops a create entirely when its landmark is deleted offline', async () => {
    const queue = new OfflineOpQueue(store, createPort());
    await queue.enqueueCreate(optimisticCreate('local:x'));
    await queue.enqueueDelete('local:x', baselineSnapshot());
    expect(queue.count).toBe(0);
    expect(queue.foldOver(fc([])).features).toHaveLength(0);
  });

  it('replaces an earlier edit with a later edit (keeps original baseline)', async () => {
    const queue = new OfflineOpQueue(store, createPort());
    const base = baselineSnapshot();
    await queue.enqueueUpdate('lm-1', base, { ...base, name: 'First' });
    await queue.enqueueUpdate('lm-1', { ...base, name: 'First' }, { ...base, name: 'Second' });
    expect(queue.count).toBe(1);
    const views = queue.views();
    expect(views[0].title).toBe('Second');
  });

  it('lets a delete supersede a pending edit for the same landmark', async () => {
    const queue = new OfflineOpQueue(store, createPort());
    const base = baselineSnapshot();
    await queue.enqueueUpdate('lm-1', base, { ...base, name: 'Edited' });
    await queue.enqueueDelete('lm-1', base);
    expect(queue.count).toBe(1);
    expect(queue.views()[0].kind).toBe('delete');
  });

  it('lets a later edit replace a pending delete for the same landmark', async () => {
    const queue = new OfflineOpQueue(store, createPort());
    const base = baselineSnapshot();
    await queue.enqueueDelete('lm-1', base);
    await queue.enqueueUpdate('lm-1', base, { ...base, name: 'Undo Delete With Edit' });

    expect(queue.count).toBe(1);
    const [view] = queue.views();
    expect(view.kind).toBe('update');
    expect(view.title).toBe('Undo Delete With Edit');
  });
});

describe('OfflineOpQueue replay', () => {
  let store: OfflineOpStore;

  beforeEach(() => {
    ({ store } = createMemoryStore());
  });

  it('replays a create, captures the real id, and writes ground truth', async () => {
    const port = createPort();
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueCreate(optimisticCreate());

    const summary = await queue.syncAll();

    expect(summary.succeeded).toBe(1);
    expect(port.applyUpsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'lm-1' }));
    expect(queue.count).toBe(0);
  });

  it('coalesces overlapping full replay commands into one remote mutation', async () => {
    const releasePost = deferred<void>();
    const postLandmark = vi.fn(async () => {
      await releasePost.promise;
      return { status: 201, data: { landmark: SERVER_LANDMARK } };
    });
    const port = createPort({ postLandmark });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueCreate(optimisticCreate());

    const first = queue.syncAll();
    await vi.waitFor(() => expect(postLandmark).toHaveBeenCalled());
    const second = queue.syncAll();
    expect(second).toBe(first);
    releasePost.resolve();

    const [firstSummary, secondSummary] = await Promise.all([first, second]);

    expect(postLandmark).toHaveBeenCalledOnce();
    expect(port.fetchLandmarksGeoJSON).toHaveBeenCalledOnce();
    expect(secondSummary).toEqual(firstSummary);
  });

  it('keeps the serialized command lane usable after a shared replay rejects', async () => {
    const storageError = new Error('ground-truth transaction failed');
    const applyUpsert = vi
      .fn()
      .mockRejectedValueOnce(storageError)
      .mockResolvedValue(undefined);
    const port = createPort({ applyUpsert });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueCreate(optimisticCreate());

    const first = queue.syncAll();
    const shared = queue.syncAll();
    const failures = await Promise.allSettled([first, shared]);

    expect(failures).toEqual([
      expect.objectContaining({ status: 'rejected', reason: storageError }),
      expect.objectContaining({ status: 'rejected', reason: storageError }),
    ]);
    expect(port.postLandmark).toHaveBeenCalledOnce();
    expect(queue.isReplaying).toBe(false);

    const retry = await queue.syncAll();

    expect(retry.succeeded).toBe(1);
    expect(port.postLandmark).toHaveBeenCalledTimes(2);
    expect(queue.count).toBe(0);
  });

  it('serializes a single-op replay behind an incompatible full replay', async () => {
    const releasePost = deferred<void>();
    const postLandmark = vi.fn(async () => {
      await releasePost.promise;
      return { status: 201, data: { landmark: SERVER_LANDMARK } };
    });
    const port = createPort({ postLandmark });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueCreate(optimisticCreate());
    const [{ id }] = queue.views();

    const fullReplay = queue.syncAll();
    await vi.waitFor(() => expect(postLandmark).toHaveBeenCalled());
    const singleReplay = queue.syncOne(id);
    releasePost.resolve();

    const [fullSummary, singleSummary] = await Promise.all([fullReplay, singleReplay]);

    expect(postLandmark).toHaveBeenCalledOnce();
    expect(fullSummary.succeeded).toBe(1);
    expect(singleSummary.reason).toBe('nothing_to_sync');
  });

  it('retains a confirmed create when the strict ground-truth commit fails', async () => {
    const storageError = new Error('ground-truth transaction failed');
    const port = createPort({
      applyUpsert: vi.fn(async () => { throw storageError; }),
    });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueCreate(optimisticCreate());

    await expect(queue.syncAll()).rejects.toBe(storageError);

    expect(store.remove).not.toHaveBeenCalled();
    expect(queue.count).toBe(1);
  });

  it('treats a "already exists" 400 as success by matching server identity', async () => {
    // The create actually committed server-side (e.g. a 200-to-nothing tunnel),
    // so a replay must not duplicate it.
    const existing = landmarkFeature('lm-real', { name: 'New Camp' }, 20, 10);
    const fetchLandmarksGeoJSON = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, data: fc([]) })
      .mockResolvedValueOnce({ status: 200, data: fc([existing]) });
    const port = createPort({
      postLandmark: vi.fn(async () => ({
        status: 400,
        data: { error: 'A landmark for GPS coordinate (10, 20) already exists or is invalid.' },
      })),
      fetchLandmarksGeoJSON,
    });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueCreate(optimisticCreate());

    const summary = await queue.syncAll();

    expect(summary.succeeded).toBe(1);
    expect(port.postLandmark).toHaveBeenCalledOnce();
    expect(fetchLandmarksGeoJSON).toHaveBeenCalledTimes(2);
    expect(port.applyUpsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'lm-real' }));
    expect(queue.count).toBe(0);
  });

  it('adopts a freshly pulled matching create before POST after a prior local commit failure', async () => {
    const existing = landmarkFeature('lm-real', { name: 'New Camp' }, 20, 10);
    const port = createPort({
      postLandmark: vi.fn(async () => ({
        status: 201,
        data: { landmark: { ...SERVER_LANDMARK, id: 'lm-duplicate' } },
      })),
      fetchLandmarksGeoJSON: vi.fn(async () => ({ status: 200, data: fc([existing]) })),
    });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueCreate(optimisticCreate());

    const summary = await queue.syncAll();

    expect(summary.succeeded).toBe(1);
    expect(port.postLandmark).not.toHaveBeenCalled();
    expect(port.applyUpsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'lm-real' }));
    expect(queue.count).toBe(0);
  });

  it('dedupes a malformed 2xx create response by re-pulling the server before finalizing', async () => {
    const existing = landmarkFeature('lm-real', { name: 'New Camp' }, 20, 10);
    const fetchLandmarksGeoJSON = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, data: fc([]) })
      .mockResolvedValueOnce({ status: 200, data: fc([existing]) });
    const port = createPort({
      postLandmark: vi.fn(async () => ({ status: 201, data: { ok: true } })),
      fetchLandmarksGeoJSON,
    });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueCreate(optimisticCreate());

    const summary = await queue.syncAll();

    expect(summary.succeeded).toBe(1);
    expect(fetchLandmarksGeoJSON).toHaveBeenCalledTimes(2);
    expect(port.applyUpsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'lm-real' }));
    expect(port.applyUpsert).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'local:new' }));
    expect(queue.count).toBe(0);
  });

  it('keeps a malformed 2xx create queued when the fresh server pull cannot prove it exists', async () => {
    const port = createPort({
      postLandmark: vi.fn(async () => ({ status: 201, data: { ok: true } })),
      fetchLandmarksGeoJSON: vi.fn(async () => ({ status: 200, data: fc([]) })),
    });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueCreate(optimisticCreate());

    const summary = await queue.syncAll();

    expect(summary.failed).toBe(1);
    expect(port.applyUpsert).not.toHaveBeenCalled();
    expect(queue.count).toBe(1);
    expect(queue.views()[0].status).toBe('error');
  });

  it('pushes an edit when the server still matches the baseline', async () => {
    const server = landmarkFeature('lm-1', { name: 'Camp', description: 'Base', collection: 'col-1' }, -122.25, 45.5);
    const port = createPort({
      fetchLandmarksGeoJSON: vi.fn(async () => ({ status: 200, data: fc([server]) })),
    });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueUpdate('lm-1', baselineSnapshot(), { ...baselineSnapshot(), name: 'Renamed' });

    const summary = await queue.syncAll();

    expect(summary.succeeded).toBe(1);
    expect(port.patchLandmark).toHaveBeenCalledWith('lm-1', expect.objectContaining({ name: 'Renamed' }));
    expect(queue.count).toBe(0);
  });

  it('flags a conflict when the server diverged from the baseline', async () => {
    const server = landmarkFeature('lm-1', { name: 'Server Name', collection: 'col-1' }, -122.25, 45.5);
    const port = createPort({
      fetchLandmarksGeoJSON: vi.fn(async () => ({ status: 200, data: fc([server]) })),
    });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueUpdate('lm-1', baselineSnapshot(), { ...baselineSnapshot(), name: 'Mine' });

    const summary = await queue.syncAll();

    expect(summary.conflicted).toBe(1);
    expect(summary.conflictIds).toHaveLength(1);
    expect(port.patchLandmark).not.toHaveBeenCalled();
    const view = queue.views()[0];
    expect(view.status).toBe('conflict');
    expect((view.conflict?.local as LandmarkSnapshot | undefined)?.name).toBe('Mine');
    expect((view.conflict?.server as LandmarkSnapshot | undefined)?.name).toBe('Server Name');
  });

  it('pushes an edit without claiming a conflict when the baseline is unknown (null footprint)', async () => {
    // No reliable last-known server state was captured (null baseline), so even
    // though the server value differs we must NOT fabricate a conflict.
    const server = landmarkFeature('lm-1', { name: 'Server Current', collection: 'col-1' }, -122.25, 45.5);
    const port = createPort({
      fetchLandmarksGeoJSON: vi.fn(async () => ({ status: 200, data: fc([server]) })),
    });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueUpdate('lm-1', null, { ...baselineSnapshot(), name: 'Mine' });

    const summary = await queue.syncAll();

    expect(summary.conflicted).toBe(0);
    expect(summary.succeeded).toBe(1);
    expect(port.patchLandmark).toHaveBeenCalledWith('lm-1', expect.objectContaining({ name: 'Mine' }));
  });

  it('pushes a delete without claiming a conflict when the baseline is unknown (null footprint)', async () => {
    const server = landmarkFeature('lm-1', { name: 'Server Current', collection: 'col-1' }, -122.25, 45.5);
    const port = createPort({
      fetchLandmarksGeoJSON: vi.fn(async () => ({ status: 200, data: fc([server]) })),
    });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueDelete('lm-1', null);

    const summary = await queue.syncAll();

    expect(summary.conflicted).toBe(0);
    expect(summary.succeeded).toBe(1);
    expect(port.deleteLandmark).toHaveBeenCalledWith('lm-1');
  });

  it('treats a delete as done when the server already removed the landmark', async () => {
    const port = createPort({
      fetchLandmarksGeoJSON: vi.fn(async () => ({ status: 200, data: fc([]) })),
    });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueDelete('lm-1', baselineSnapshot());

    const summary = await queue.syncAll();

    expect(summary.succeeded).toBe(1);
    expect(port.deleteLandmark).not.toHaveBeenCalled();
    expect(port.applyRemoval).toHaveBeenCalledWith('lm-1');
    expect(queue.count).toBe(0);
  });

  it('does not sync when offline', async () => {
    const port = createPort({ hasNetworkAccess: () => false });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueCreate(optimisticCreate());
    const summary = await queue.syncAll();
    expect(summary.reason).toBe('offline');
    expect(port.postLandmark).not.toHaveBeenCalled();
  });
});

describe('OfflineOpQueue persistence failures', () => {
  it('does not accept an enqueue when the durable put fails', async () => {
    const failingStore = {
      list: vi.fn(async () => []),
      put: vi.fn(async () => false),
      remove: vi.fn(async () => true),
      clear: vi.fn(async () => {}),
    } as unknown as OfflineOpStore;
    const queue = new OfflineOpQueue(failingStore, createPort());

    await expect(queue.enqueueCreate(optimisticCreate())).rejects.toBeInstanceOf(
      OfflineOpPersistenceError,
    );
    expect(queue.count).toBe(0);
  });

  it('does not remove an in-memory op when the durable remove fails', async () => {
    const store = {
      list: vi.fn(async () => []),
      put: vi.fn(async () => true),
      remove: vi.fn(async () => false),
      clear: vi.fn(async () => {}),
    } as unknown as OfflineOpStore;
    const queue = new OfflineOpQueue(store, createPort());
    const op = await queue.enqueueCreate(optimisticCreate());

    await expect(queue.discard(op.id)).rejects.toBeInstanceOf(OfflineOpPersistenceError);
    expect(queue.count).toBe(1);
  });

  it.each([
    {
      label: 'landmark update with delete',
      seed: (queue: OfflineOpQueue) => queue.enqueueUpdate(
        'lm-1',
        baselineSnapshot(),
        { ...baselineSnapshot(), name: 'Edited' },
      ),
      replace: (queue: OfflineOpQueue) => queue.enqueueDelete('lm-1', baselineSnapshot()),
      currentFailure: 'put' as const,
      expectedKind: 'update',
    },
    {
      label: 'landmark delete with update',
      seed: (queue: OfflineOpQueue) => queue.enqueueDelete('lm-1', baselineSnapshot()),
      replace: (queue: OfflineOpQueue) => queue.enqueueUpdate(
        'lm-1',
        baselineSnapshot(),
        { ...baselineSnapshot(), name: 'Edited' },
      ),
      currentFailure: 'remove' as const,
      expectedKind: 'delete',
    },
    {
      label: 'GPS update with delete',
      seed: (queue: OfflineOpQueue) => queue.enqueueGpsUpdate(
        'g1',
        { name: 'Track', color: '#377eb8' },
        { name: 'Edited', color: '#377eb8' },
      ),
      replace: (queue: OfflineOpQueue) => queue.enqueueGpsDelete(
        'g1',
        { name: 'Track', color: '#377eb8' },
      ),
      currentFailure: 'put' as const,
      expectedKind: 'update',
    },
    {
      label: 'GPS delete with update',
      seed: (queue: OfflineOpQueue) => queue.enqueueGpsDelete(
        'g1',
        { name: 'Track', color: '#377eb8' },
      ),
      replace: (queue: OfflineOpQueue) => queue.enqueueGpsUpdate(
        'g1',
        { name: 'Track', color: '#377eb8' },
        { name: 'Edited', color: '#377eb8' },
      ),
      currentFailure: 'remove' as const,
      expectedKind: 'delete',
    },
  ])('keeps the durable $label when atomic replacement fails', async ({
    seed,
    replace,
    currentFailure,
    expectedKind,
  }) => {
    const { store, records } = createMemoryStore();
    const queue = new OfflineOpQueue(store, createPort());
    await seed(queue);
    vi.mocked(store.put).mockClear();
    vi.mocked(store.remove).mockClear();
    vi.mocked(store.replace).mockClear();
    const storageError = new Error('replacement transaction failed');
    vi.mocked(store.replace).mockRejectedValueOnce(storageError);
    vi.mocked(store[currentFailure]).mockRejectedValueOnce(storageError);

    await expect(replace(queue)).rejects.toThrow();

    expect(queue.views()).toHaveLength(1);
    expect(queue.views()[0].kind).toBe(expectedKind);
    expect(store.replace).toHaveBeenCalledOnce();
    expect(store.put).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
    expect(records.size).toBe(1);
    const reopened = new OfflineOpQueue(store, createPort());
    await reopened.load();
    expect(reopened.views()).toHaveLength(1);
    expect(reopened.views()[0].kind).toBe(expectedKind);
  });

  it('serializes simultaneous same-subject enqueues into one durable intent', async () => {
    const { store, records } = createMemoryStore();
    const queue = new OfflineOpQueue(store, createPort());
    const baseline = baselineSnapshot();

    await Promise.all([
      queue.enqueueUpdate('lm-1', baseline, { ...baseline, name: 'First' }),
      queue.enqueueUpdate('lm-1', baseline, { ...baseline, name: 'Second' }),
    ]);

    expect(queue.views()).toHaveLength(1);
    expect(queue.views()[0].title).toBe('Second');
    expect(records.size).toBe(1);
    const reopened = new OfflineOpQueue(store, createPort());
    await reopened.load();
    expect(reopened.views()).toHaveLength(1);
    expect(reopened.views()[0].title).toBe('Second');
  });
});

describe('OfflineOpQueue conflict resolution', () => {
  let store: OfflineOpStore;
  beforeEach(() => {
    ({ store } = createMemoryStore());
  });

  it('keep-local forces the edit regardless of server drift', async () => {
    const server = landmarkFeature('lm-1', { name: 'Server', collection: 'col-1' }, -122.25, 45.5);
    const port = createPort({
      fetchLandmarksGeoJSON: vi.fn(async () => ({ status: 200, data: fc([server]) })),
    });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueUpdate('lm-1', baselineSnapshot(), { ...baselineSnapshot(), name: 'Mine' });
    const { conflictIds } = await queue.syncAll();

    await queue.resolveConflict(conflictIds[0], 'local');

    expect(port.patchLandmark).toHaveBeenCalledWith('lm-1', expect.objectContaining({ name: 'Mine' }));
    expect(queue.count).toBe(0);
  });

  it('serializes overlapping conflict resolutions for the same operation', async () => {
    const server = landmarkFeature('lm-1', { name: 'Server', collection: 'col-1' }, -122.25, 45.5);
    const releasePatch = deferred<void>();
    const patchLandmark = vi.fn(async () => {
      await releasePatch.promise;
      return { status: 200, data: { landmark: SERVER_LANDMARK } };
    });
    const port = createPort({
      fetchLandmarksGeoJSON: vi.fn(async () => ({ status: 200, data: fc([server]) })),
      patchLandmark,
    });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueUpdate('lm-1', baselineSnapshot(), { ...baselineSnapshot(), name: 'Mine' });
    const { conflictIds } = await queue.syncAll();

    const first = queue.resolveConflict(conflictIds[0], 'local');
    await vi.waitFor(() => expect(patchLandmark).toHaveBeenCalled());
    const second = queue.resolveConflict(conflictIds[0], 'local');
    releasePatch.resolve();

    const [firstSummary, secondSummary] = await Promise.all([first, second]);

    expect(patchLandmark).toHaveBeenCalledOnce();
    expect(firstSummary.succeeded).toBe(1);
    expect(secondSummary.reason).toBe('nothing_to_sync');
  });

  it('use-server discards the local op and adopts the server version', async () => {
    const server = landmarkFeature('lm-1', { name: 'Server', collection: 'col-1' }, -122.25, 45.5);
    const port = createPort({
      fetchLandmarksGeoJSON: vi.fn(async () => ({ status: 200, data: fc([server]) })),
    });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueUpdate('lm-1', baselineSnapshot(), { ...baselineSnapshot(), name: 'Mine' });
    const { conflictIds } = await queue.syncAll();

    await queue.resolveConflict(conflictIds[0], 'server');

    expect(port.patchLandmark).not.toHaveBeenCalled();
    expect(port.applyUpsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'lm-1', name: 'Server' }));
    expect(queue.count).toBe(0);
  });

  it('reports a failed keep-local resolution when the force push gets a 4xx', async () => {
    const server = landmarkFeature('lm-1', { name: 'Server', collection: 'col-1' }, -122.25, 45.5);
    const port = createPort({
      fetchLandmarksGeoJSON: vi.fn(async () => ({ status: 200, data: fc([server]) })),
      patchLandmark: vi.fn(async () => ({ status: 403, data: { detail: 'No permission' } })),
    });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueUpdate('lm-1', baselineSnapshot(), { ...baselineSnapshot(), name: 'Mine' });
    const { conflictIds } = await queue.syncAll();

    const summary = await queue.resolveConflict(conflictIds[0], 'local');

    expect(summary.succeeded).toBe(0);
    expect(summary.failed).toBe(1);
    expect(queue.count).toBe(1);
    const [view] = queue.views();
    expect(view.status).toBe('error');
    expect(view.lastError).toBe('No permission');
  });
});

describe('OfflineOpQueue chaos', () => {
  it('survives a force-quit after the PATCH committed and replays idempotently', async () => {
    // Real force-quit: the user edited name Old -> Camp, the PATCH committed
    // server-side, but the process died before the op was removed. So the op's
    // baseline is the PRE-edit state (Old) while the server already holds the
    // POST-edit state (Camp == the op's `next`). On relaunch the baseline no
    // longer matches the server -- naively this looks like a conflict -- but the
    // server is already at our intended end state, so the op must drain cleanly
    // (no false, empty-diff conflict).
    const { store, records } = createMemoryStore();
    const server = landmarkFeature('lm-1', { name: 'Camp', description: 'Base', collection: 'col-1' }, -122.25, 45.5);
    const queue1 = new OfflineOpQueue(store, createPort());
    await queue1.enqueueUpdate(
      'lm-1',
      { ...baselineSnapshot(), name: 'Old' }, // pre-edit baseline
      { ...baselineSnapshot(), name: 'Camp' }, // intended end state (now on server)
    );
    // Simulate crash: op is still persisted (we never synced queue1).
    expect(records.size).toBe(1);

    // Reopen: a fresh queue loads from the store and replays. The server already
    // equals `next`, so the op is recognized as satisfied and removed without a
    // redundant PATCH or a spurious conflict.
    const patchLandmark = vi.fn(async () => ({ status: 200, data: { landmark: SERVER_LANDMARK } }));
    const port = createPort({
      fetchLandmarksGeoJSON: vi.fn(async () => ({ status: 200, data: fc([server]) })),
      patchLandmark,
    });
    const queue2 = new OfflineOpQueue(store, port);
    const summary = await queue2.syncAll();

    expect(summary.succeeded).toBe(1);
    expect(summary.conflicted).toBe(0);
    expect(records.size).toBe(0);
    // Server already matched the intended state, so no redundant write was sent.
    expect(patchLandmark).not.toHaveBeenCalled();
    expect(port.applyUpsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'lm-1', name: 'Camp' }));
  });

  it('still conflicts when the server genuinely diverged from baseline and next', async () => {
    // A real two-device change: the server now holds a value that matches
    // neither the op's baseline (pre-edit) nor its `next` (intended). This must
    // surface a conflict and must NOT silently overwrite the server.
    const { store } = createMemoryStore();
    const server = landmarkFeature(
      'lm-1',
      { name: 'Someone Else Edit', description: 'Base', collection: 'col-1' },
      -122.25,
      45.5,
    );
    const port = createPort({
      fetchLandmarksGeoJSON: vi.fn(async () => ({ status: 200, data: fc([server]) })),
    });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueUpdate(
      'lm-1',
      { ...baselineSnapshot(), name: 'Old' },
      { ...baselineSnapshot(), name: 'Mine' },
    );

    const summary = await queue.syncAll();

    expect(summary.conflicted).toBe(1);
    expect(summary.succeeded).toBe(0);
    expect(port.patchLandmark).not.toHaveBeenCalled();
    expect(queue.count).toBe(1);
  });

  it('drains independent ops even when one fails (partial failure)', async () => {
    const { store } = createMemoryStore();
    const port = createPort({
      // First op (create) hits a hard 400 validation error; second op (delete of
      // an already-removed landmark) still succeeds.
      postLandmark: vi.fn(async () => ({ status: 400, data: { errors: { name: ['Too long'] } } })),
      fetchLandmarksGeoJSON: vi.fn(async () => ({ status: 200, data: fc([]) })),
    });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueCreate(optimisticCreate('local:bad'));
    await queue.enqueueDelete('lm-1', baselineSnapshot());

    const summary = await queue.syncAll();

    expect(summary.failed).toBe(1);
    expect(summary.succeeded).toBe(1);
    // The failed create stays in the queue (marked error); the delete drained.
    expect(queue.count).toBe(1);
    expect(queue.views().find((v) => v.kind === 'create')?.status).toBe('error');
  });

  it('leaves remaining ops pending when connectivity drops mid-run', async () => {
    const { store } = createMemoryStore();
    let calls = 0;
    const port = createPort({
      // The pull succeeds; the first POST returns a 5xx (treated as unreachable).
      postLandmark: vi.fn(async () => {
        calls += 1;
        return { status: 503, data: {} };
      }),
    });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueCreate(optimisticCreate('local:a'));
    await queue.enqueueCreate(optimisticCreate('local:b'));

    const summary = await queue.syncAll();

    expect(summary.reason).toBe('pull_failed');
    expect(calls).toBe(1); // aborted after the first unreachable response
    expect(queue.count).toBe(2); // nothing dropped
  });

  it('handles a chained create + edit + delete on a temp id as a no-op', async () => {
    const { store } = createMemoryStore();
    const port = createPort();
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueCreate(optimisticCreate('local:z'));
    await queue.enqueueUpdate('local:z', baselineSnapshot(), { ...baselineSnapshot(), name: 'Edited' });
    await queue.enqueueDelete('local:z', baselineSnapshot());

    // Create + edit coalesced into one create; delete then dropped it entirely.
    expect(queue.count).toBe(0);
    const summary = await queue.syncAll();
    expect(summary.reason).toBe('nothing_to_sync');
    expect(port.postLandmark).not.toHaveBeenCalled();
  });
});

// ---- GPS track ops --------------------------------------------------------

function remoteTrack(overrides: Partial<RemoteGpsTrack> = {}): RemoteGpsTrack {
  return {
    id: 'g1',
    name: 'Server Track',
    color: '#377eb8',
    fileUrl: 'https://files.test/g1.geojson',
    sha256: 'abc',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('OfflineOpQueue GPS tracks', () => {
  let store: OfflineOpStore;
  beforeEach(() => {
    ({ store } = createMemoryStore());
  });

  it('replays a create op as a GPX upload, then deletes the local copy', async () => {
    const port = createPort();
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueGpsCreate({ id: 'local-1', name: 'Walk', color: '#e41a1c' });
    expect(queue.count).toBe(1);

    const summary = await queue.syncAll();
    expect(summary.succeeded).toBe(1);
    expect(port.uploadGpsTrack).toHaveBeenCalledWith('local-1');
    expect(port.onGpsTrackCreated).toHaveBeenCalledWith('local-1');
    expect(queue.count).toBe(0);
  });

  it('keeps a create op pending on a 5xx upload', async () => {
    const port = createPort({ uploadGpsTrack: vi.fn(async () => ({ status: 503, data: {} })) });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueGpsCreate({ id: 'local-1', name: 'Walk', color: '#e41a1c' });

    const summary = await queue.syncAll();
    expect(summary.reason).toBe('pull_failed');
    expect(queue.count).toBe(1);
    expect(port.onGpsTrackCreated).not.toHaveBeenCalled();
  });

  it('folds a pending update over the server track list (optimistic name/color)', async () => {
    const port = createPort();
    const queue = new OfflineOpQueue(store, port);
    const baseline: GpsTrackSnapshot = { name: 'Server Track', color: '#377eb8' };
    await queue.enqueueGpsUpdate('g1', baseline, { name: 'Renamed', color: '#4daf4a' });

    const folded = queue.foldGpsTracks([remoteTrack()]);
    expect(folded[0]).toMatchObject({ id: 'g1', name: 'Renamed', color: '#4daf4a' });
    expect(queue.gpsPendingBySubject().get('g1')?.state).toBe('update');
  });

  it('folds a pending delete by removing the track from the list', async () => {
    const port = createPort();
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueGpsDelete('g1', { name: 'Server Track', color: '#377eb8' });
    expect(queue.foldGpsTracks([remoteTrack()])).toHaveLength(0);
    expect(queue.gpsPendingBySubject().get('g1')?.state).toBe('delete');
  });

  it('replays an update via PATCH when the server still matches the baseline', async () => {
    const port = createPort({
      fetchGpsTracks: vi.fn(async () => ({ status: 200, data: [{
        id: 'g1', name: 'Server Track', color: '#377eb8',
        file: 'https://files.test/g1.geojson', sha256_hash: 'abc',
        creation_date: '2024-01-01T00:00:00Z', modified_date: '2024-01-01T00:00:00Z',
      }] })),
    });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueGpsUpdate('g1', { name: 'Server Track', color: '#377eb8' }, { name: 'New', color: '#984ea3' });

    const summary = await queue.syncAll();
    expect(summary.succeeded).toBe(1);
    expect(port.patchGpsTrack).toHaveBeenCalledWith('g1', { name: 'New', color: '#984ea3' });
    expect(port.applyGpsTrackUpsert).toHaveBeenCalled();
    expect(queue.count).toBe(0);
  });

  it('raises a conflict when the server track drifted from the update baseline', async () => {
    const port = createPort({
      fetchGpsTracks: vi.fn(async () => ({ status: 200, data: [{
        id: 'g1', name: 'Server Changed', color: '#377eb8',
        file: 'https://files.test/g1.geojson', sha256_hash: 'abc',
        creation_date: '2024-01-01T00:00:00Z', modified_date: '2024-01-01T00:00:00Z',
      }] })),
    });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueGpsUpdate('g1', { name: 'Server Track', color: '#377eb8' }, { name: 'Mine', color: '#984ea3' });

    const summary = await queue.syncAll();
    expect(summary.conflicted).toBe(1);
    expect(port.patchGpsTrack).not.toHaveBeenCalled();
    const view = queue.views()[0];
    expect(view.entityType).toBe('gpsTrack');
    expect(view.conflict?.entityLabel).toBe('GPS track');
    expect(view.conflict?.rows.some((r) => r.field === 'name')).toBe(true);
  });

  it('treats a missing server track as a satisfied delete (idempotent)', async () => {
    const port = createPort({ fetchGpsTracks: vi.fn(async () => ({ status: 200, data: [] })) });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueGpsDelete('g1', { name: 'Server Track', color: '#377eb8' });

    const summary = await queue.syncAll();
    expect(summary.succeeded).toBe(1);
    expect(port.applyGpsTrackRemoval).toHaveBeenCalledWith('g1');
    expect(queue.count).toBe(0);
  });

  it('coalesces a second edit and lets a delete supersede an edit', async () => {
    const port = createPort();
    const queue = new OfflineOpQueue(store, port);
    const baseline: GpsTrackSnapshot = { name: 'Server Track', color: '#377eb8' };
    await queue.enqueueGpsUpdate('g1', baseline, { name: 'Edit1', color: '#377eb8' });
    await queue.enqueueGpsUpdate('g1', baseline, { name: 'Edit2', color: '#377eb8' });
    expect(queue.count).toBe(1);
    await queue.enqueueGpsDelete('g1', baseline);
    expect(queue.count).toBe(1);
    expect(queue.gpsPendingBySubject().get('g1')?.state).toBe('delete');
  });

  it('round-trips a gps op through persistence (deserialize)', async () => {
    const port = createPort();
    const queue1 = new OfflineOpQueue(store, port);
    await queue1.enqueueGpsUpdate('g1', { name: 'A', color: '#111111' }, { name: 'B', color: '#222222' });

    const queue2 = new OfflineOpQueue(store, port);
    await queue2.load();
    expect(queue2.count).toBe(1);
    expect(queue2.foldGpsTracks([remoteTrack()])[0]).toMatchObject({ name: 'B', color: '#222222' });
  });

  it('runs a mixed landmark + gps queue, pulling both server snapshots', async () => {
    const port = createPort();
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueCreate(optimisticCreate('local:lm'));
    await queue.enqueueGpsCreate({ id: 'local-g', name: 'Walk', color: '#e41a1c' });

    const summary = await queue.syncAll();
    expect(summary.succeeded).toBe(2);
    expect(port.postLandmark).toHaveBeenCalled();
    expect(port.uploadGpsTrack).toHaveBeenCalledWith('local-g');
    expect(queue.count).toBe(0);
  });

  // ---- GPS conflict resolution (forceLocal + adoptServer) -----------------
  // The server drifted (`Server Changed`) from the op's baseline (`Server
  // Track`), so syncAll raises a conflict; the user then resolves it.
  const driftedServerRaw = {
    id: 'g1', name: 'Server Changed', color: '#377eb8',
    file: 'https://files.test/g1.geojson', sha256_hash: 'abc',
    creation_date: '2024-01-01T00:00:00Z', modified_date: '2024-01-02T00:00:00Z',
  };
  const gpsBaseline: GpsTrackSnapshot = { name: 'Server Track', color: '#377eb8' };

  it('keep-local resolves a GPS edit conflict by forcing the PATCH', async () => {
    const port = createPort({ fetchGpsTracks: vi.fn(async () => ({ status: 200, data: [driftedServerRaw] })) });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueGpsUpdate('g1', gpsBaseline, { name: 'Mine', color: '#984ea3' });
    const { conflictIds } = await queue.syncAll();
    expect(conflictIds).toHaveLength(1);

    const summary = await queue.resolveConflict(conflictIds[0], 'local');
    expect(summary.succeeded).toBe(1);
    expect(port.patchGpsTrack).toHaveBeenCalledWith('g1', { name: 'Mine', color: '#984ea3' });
    expect(port.applyGpsTrackUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'g1', name: 'Mine', color: '#984ea3' }),
    );
    expect(queue.count).toBe(0);
  });

  it('use-server resolves a GPS edit conflict by adopting the server track', async () => {
    const port = createPort({ fetchGpsTracks: vi.fn(async () => ({ status: 200, data: [driftedServerRaw] })) });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueGpsUpdate('g1', gpsBaseline, { name: 'Mine', color: '#984ea3' });
    const { conflictIds } = await queue.syncAll();

    const summary = await queue.resolveConflict(conflictIds[0], 'server');
    expect(summary.succeeded).toBe(1);
    expect(port.patchGpsTrack).not.toHaveBeenCalled();
    expect(port.applyGpsTrackUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'g1', name: 'Server Changed' }),
    );
    expect(queue.count).toBe(0);
  });

  it('reports a failed keep-local GPS edit when the forced PATCH gets a 4xx', async () => {
    const port = createPort({
      fetchGpsTracks: vi.fn(async () => ({ status: 200, data: [driftedServerRaw] })),
      patchGpsTrack: vi.fn(async () => ({ status: 403, data: { detail: 'No permission' } })),
    });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueGpsUpdate('g1', gpsBaseline, { name: 'Mine', color: '#984ea3' });
    const { conflictIds } = await queue.syncAll();

    const summary = await queue.resolveConflict(conflictIds[0], 'local');
    expect(summary.failed).toBe(1);
    expect(summary.succeeded).toBe(0);
    expect(queue.count).toBe(1);
    expect(queue.views()[0].status).toBe('error');
  });

  it('keep-local resolves a GPS delete conflict by forcing the DELETE', async () => {
    const port = createPort({ fetchGpsTracks: vi.fn(async () => ({ status: 200, data: [driftedServerRaw] })) });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueGpsDelete('g1', gpsBaseline);
    const { conflictIds } = await queue.syncAll();
    expect(conflictIds).toHaveLength(1);

    const summary = await queue.resolveConflict(conflictIds[0], 'local');
    expect(summary.succeeded).toBe(1);
    expect(port.deleteGpsTrackRemote).toHaveBeenCalledWith('g1');
    expect(port.applyGpsTrackRemoval).toHaveBeenCalledWith('g1');
    expect(queue.count).toBe(0);
  });

  it('use-server resolves a GPS delete conflict by keeping the changed server track', async () => {
    const port = createPort({ fetchGpsTracks: vi.fn(async () => ({ status: 200, data: [driftedServerRaw] })) });
    const queue = new OfflineOpQueue(store, port);
    await queue.enqueueGpsDelete('g1', gpsBaseline);
    const { conflictIds } = await queue.syncAll();

    const summary = await queue.resolveConflict(conflictIds[0], 'server');
    expect(summary.succeeded).toBe(1);
    expect(port.deleteGpsTrackRemote).not.toHaveBeenCalled();
    expect(port.applyGpsTrackUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'g1', name: 'Server Changed' }),
    );
    expect(queue.count).toBe(0);
  });
});
