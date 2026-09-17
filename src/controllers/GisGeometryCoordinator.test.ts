import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GisGeometryCoordinator } from './GisGeometryCoordinator';
import { GisGeometryCacheService } from '../services/GisGeometryCacheService';
import { CacheStore } from '../services/CacheStore';
import { deferred, GEOMETRY_ID, geometryDetail, geometryMetadata } from '../gisGeometry/testFixtures';
import type { HttpResponse } from '../services/HttpClient';
import type { StoredSession } from '../services/SecureSessionStore';

const store = new CacheStore();
beforeEach(async () => { await store.clear('projects'); await store.clear('geojson'); });
function harness() {
  let session: StoredSession | null = { token: 'secret', instance: 'https://example.test', cacheScopeId: 'account-a' };
  let online = true;
  const service = {
    getGisGeometries: vi.fn(async (): Promise<HttpResponse<unknown>> => ({ status: 200, data: [geometryMetadata()] })),
    getGisGeometry: vi.fn(async (_instance: string, _token: string, id: string): Promise<HttpResponse<unknown>> => ({ status: 200, data: geometryDetail({ id }) })),
  };
  const revoked = vi.fn(async (_ids: string[], _scope: string, validate: () => void) => { validate(); });
  const cache = new GisGeometryCacheService(store);
  const coordinator = new GisGeometryCoordinator({ service, cache, getSession: () => session, hasNetworkAccess: () => online, onRevoked: revoked });
  return { service, coordinator, cache, revoked, setOnline: (value: boolean) => { online = value; }, setSession: (value: StoredSession | null) => { session = value; } };
}
describe('GIS Geometry shared read coordinator', () => {
  it('persists fresh access when newer durable content survived an interrupted catalog write', async () => {
    const h = harness();
    const admin = { user_permission_level: 3 as const, user_permission_level_label: 'ADMIN' as const,
      can_write: true, can_delete: true, can_manage_permissions: true };
    h.service.getGisGeometry.mockResolvedValue({ status: 200, data: geometryDetail({ revision: 2, name: 'New content', ...admin }) });
    const putCatalog = h.cache.putCatalog.bind(h.cache);
    const writes = vi.spyOn(h.cache, 'putCatalog').mockImplementation(async (...args) => {
      if (args[0].items.some(item => item.revision === 2)) throw new Error('Catalog storage unavailable');
      return putCatalog(...args);
    });
    await h.coordinator.refresh(); await h.coordinator.waitForIdle();
    expect((await h.cache.getDetail('account-a', GEOMETRY_ID))?.detail.revision).toBe(2);
    expect(h.coordinator.getSnapshot().items[0].revision).toBe(1);
    writes.mockImplementation(putCatalog);
    h.service.getGisGeometry.mockResolvedValue({ status: 200, data: geometryDetail() });
    const record = await h.coordinator.ensureDetail(GEOMETRY_ID);
    await h.coordinator.waitForIdle();
    expect(record.detail).toMatchObject({ revision: 2, name: 'New content', can_delete: false, user_permission_level: 1 });
    expect(h.coordinator.getSnapshot().items[0].can_delete).toBe(false);
    expect((await h.cache.getDetail('account-a', GEOMETRY_ID))?.detail.can_delete).toBe(false);
    const reopened = harness(); reopened.setOnline(false); await reopened.coordinator.load();
    expect(reopened.coordinator.getSnapshot().records[GEOMETRY_ID].detail).toMatchObject({ revision: 2, can_delete: false });
  });

  it.each([200, 403, 404, 503])('loads a fresh regrant before a revoked detail task finishes with %s', async status => {
    const h = harness(), oldRead = deferred<HttpResponse<unknown>>();
    h.service.getGisGeometry.mockReturnValueOnce(oldRead.promise);
    await h.coordinator.refresh();
    const obsoleteRead = h.coordinator.ensureDetail(GEOMETRY_ID);
    const rejected = expect(obsoleteRead).rejects.toMatchObject({ name: 'AbortError' });
    h.service.getGisGeometries.mockResolvedValueOnce({ status: 200, data: [] });
    await h.coordinator.refresh();
    expect(h.coordinator.getSnapshot().loadingIds).toEqual([]);
    await h.coordinator.refresh();
    const freshRead = h.coordinator.ensureDetail(GEOMETRY_ID);
    try {
      await vi.waitFor(() => expect(h.service.getGisGeometry).toHaveBeenCalledTimes(2));
      expect((await freshRead).detail.id).toBe(GEOMETRY_ID);
    } finally {
      oldRead.resolve({ status, data: status === 200 ? geometryDetail({ revision: 99 }) : {} });
      await Promise.allSettled([freshRead]);
      await rejected; await h.coordinator.waitForIdle();
    }
    expect(h.coordinator.getSnapshot().records[GEOMETRY_ID].detail.revision).toBe(1);
    expect(h.coordinator.getSnapshot().errors[GEOMETRY_ID]).toBeUndefined();
    expect((await h.cache.getDetail('account-a', GEOMETRY_ID))?.detail.revision).toBe(1);
    expect((await h.cache.getCatalog('account-a'))?.revokedIds).toEqual([]);
  });

  it('returns healthy geometry sources while retaining only failed accessible members', async () => {
    const h = harness();
    const failedId = '12345678-1234-4234-8234-000000000002';
    h.service.getGisGeometries.mockResolvedValue({ status: 200, data: [geometryMetadata(), geometryMetadata({ id: failedId })] });
    h.service.getGisGeometry.mockImplementation(async (_instance, _token, id) => id === failedId
      ? { status: 503, data: {} }
      : { status: 200, data: geometryDetail({ id }) });
    const snapshot = await h.coordinator.getPrefetchSnapshot();
    expect(snapshot.complete).toBe(true);
    expect(snapshot.sources.map(source => source.id)).toEqual([GEOMETRY_ID]);
    expect(snapshot.retainedSourceKeys).toEqual([`gis-geometry:${failedId}`]);
    expect(h.coordinator.getSnapshot().errors[failedId]).toBeDefined();
    await h.coordinator.waitForIdle();
  });

  it.each([403, 404, 503])('preserves unknown membership after collection %s without automatic retries', async status => {
    const h = harness();
    h.service.getGisGeometries.mockResolvedValue({ status, data: {} });
    expect(await h.coordinator.getPrefetchSnapshot()).toEqual(expect.objectContaining({ sources: [], complete: false, retainedSourceKeys: [] }));
    expect(await h.coordinator.getPrefetchSnapshot()).toEqual(expect.objectContaining({ sources: [], complete: false, retainedSourceKeys: [] }));
    expect(h.service.getGisGeometries).toHaveBeenCalledTimes(1);
    expect(h.service.getGisGeometry).not.toHaveBeenCalled();
  });

  it('recovers failed metadata on explicit tile refresh without retrying ordinary reads', async () => {
    const h = harness();
    h.service.getGisGeometries.mockResolvedValueOnce({ status: 503, data: {} });
    expect((await h.coordinator.getPrefetchSnapshot()).complete).toBe(false);
    expect((await h.coordinator.getPrefetchSnapshot()).complete).toBe(false);
    const recovered = await h.coordinator.getPrefetchSnapshot(undefined, { refresh: true });
    expect(recovered.complete).toBe(true);
    expect(recovered.sources.map(source => source.id)).toEqual([GEOMETRY_ID]);
    expect(h.service.getGisGeometries).toHaveBeenCalledTimes(2);
    await h.coordinator.waitForIdle();
  });

  it.each([403, 404])('does not retain a detail denied with %s while collection revalidation runs', async status => {
    const h = harness(), detail = deferred<HttpResponse<unknown>>(), revalidation = deferred<HttpResponse<unknown>>();
    h.service.getGisGeometries.mockResolvedValueOnce({ status: 200, data: [geometryMetadata()] }).mockReturnValue(revalidation.promise);
    h.service.getGisGeometry.mockReturnValue(detail.promise);
    await h.coordinator.refresh();
    const prefetch = h.coordinator.getPrefetchSnapshot();
    detail.resolve({ status, data: {} });
    expect(await prefetch).toEqual(expect.objectContaining({ sources: [], complete: false, retainedSourceKeys: [] }));
    expect(h.coordinator.getSnapshot().items).toEqual([]);
    expect(h.revoked).toHaveBeenCalledWith([GEOMETRY_ID], 'account-a', expect.any(Function));
    revalidation.resolve({ status: 200, data: [] });
    await h.coordinator.waitForIdle();
    expect(await h.coordinator.getPrefetchSnapshot()).toEqual(expect.objectContaining({ sources: [], complete: true, retainedSourceKeys: [] }));
    expect(h.service.getGisGeometry).toHaveBeenCalledTimes(1);
    expect(h.service.getGisGeometries).toHaveBeenCalledTimes(2);
  });

  it('reports incomplete authority without aborting tile work when a newer collection arrives', async () => {
    const h = harness(), detail = deferred<HttpResponse<unknown>>();
    h.service.getGisGeometry.mockReturnValue(detail.promise);
    await h.coordinator.refresh();
    const prefetch = h.coordinator.getPrefetchSnapshot();
    h.service.getGisGeometries.mockResolvedValue({ status: 200, data: [geometryMetadata({ name: 'Renamed' })] });
    await h.coordinator.refresh();
    detail.resolve({ status: 200, data: geometryDetail() });
    expect(await prefetch).toEqual(expect.objectContaining({ sources: [], complete: false, retainedSourceKeys: [] }));
    await h.coordinator.waitForIdle();
  });

  it('still aborts partial source reads when their authenticated account changes', async () => {
    const h = harness(), metadata = deferred<HttpResponse<unknown>>();
    h.service.getGisGeometries.mockReturnValue(metadata.promise);
    const prefetch = h.coordinator.getPrefetchSnapshot();
    const rejected = expect(prefetch).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(h.service.getGisGeometries).toHaveBeenCalledOnce());
    h.setSession({ token: 'other', instance: 'https://example.test', cacheScopeId: 'account-b' });
    metadata.resolve({ status: 200, data: [geometryMetadata()] });
    await rejected;
    await h.coordinator.waitForIdle();
  });

  it('fences a prepared snapshot against revocation while allowing capability-only refreshes', async () => {
    const h = harness();
    const prepared = await h.coordinator.getPrefetchSnapshot();
    expect(prepared.isCurrent()).toBe(true);
    h.service.getGisGeometries.mockResolvedValue({ status: 200, data: [geometryMetadata({
      user_permission_level: 3, user_permission_level_label: 'ADMIN',
      can_write: true, can_delete: true, can_manage_permissions: true,
    })] });
    await h.coordinator.refresh();
    expect(prepared.isCurrent()).toBe(true);
    h.service.getGisGeometries.mockResolvedValue({ status: 200, data: [] });
    await h.coordinator.refresh();
    expect(prepared.isCurrent()).toBe(false);
    await h.coordinator.waitForIdle();
  });

  it('invalidates prepared bounds after a content revision or account change', async () => {
    const h = harness();
    const prepared = await h.coordinator.getPrefetchSnapshot();
    h.service.getGisGeometries.mockResolvedValue({ status: 200, data: [geometryMetadata({ revision: 2 })] });
    h.service.getGisGeometry.mockResolvedValue({ status: 200, data: geometryDetail({ revision: 2 }) });
    const updated = await h.coordinator.getPrefetchSnapshot(undefined, { refresh: true });
    expect(prepared.isCurrent()).toBe(false);
    expect(updated.isCurrent()).toBe(true);
    h.setSession({ token: 'other', instance: 'https://example.test', cacheScopeId: 'account-b' });
    expect(updated.isCurrent()).toBe(false);
    await h.coordinator.waitForIdle();
  });

  it.each([403, 200])('removes known revoked access on collection %s even if the durable catalog transaction aborts', async status => {
    const h = harness();
    await h.coordinator.refresh();
    await h.coordinator.waitForIdle();
    expect(h.coordinator.getSnapshot().records[GEOMETRY_ID]).toBeDefined();
    const failedWrite = vi.spyOn(h.cache, 'putCatalog').mockImplementation(async catalog => {
      await store.update('projects', `gis-geometry:${catalog.scope}:catalog`, () => {
        throw new Error('catalog transaction unavailable');
      });
    });
    h.service.getGisGeometries.mockResolvedValue({ status, data: [] });
    await expect(h.coordinator.refresh()).rejects.toThrow();
    expect(h.coordinator.getSnapshot().items).toEqual([]);
    expect(h.coordinator.getSnapshot().records).toEqual({});
    await expect(h.coordinator.ensureDetail(GEOMETRY_ID)).rejects.toThrow('no longer available');
    await expect(h.coordinator.getPrefetchSources()).rejects.toThrow('not current');
    expect(h.revoked).toHaveBeenCalledWith([GEOMETRY_ID], 'account-a', expect.any(Function));
    expect(await h.cache.getDetail('account-a', GEOMETRY_ID)).toBeNull();
    // The failed transaction preserved old metadata, but cannot keep the overlay
    // usable; a later explicit refresh retries the retained deletion authority.
    expect((await h.cache.getCatalog('account-a'))?.items).toHaveLength(1);
    failedWrite.mockRestore();
    h.service.getGisGeometries.mockResolvedValue({ status: 200, data: [] });
    await h.coordinator.refresh();
    expect((await h.cache.getCatalog('account-a'))?.revokedIds).toContain(GEOMETRY_ID);
    await h.coordinator.waitForIdle();
  });
  it('establishes initial metadata for standalone offline preparation without retrying a denied collection', async () => {
    const h = harness();
    expect(await h.coordinator.getPrefetchSources()).toHaveLength(1);
    expect(h.service.getGisGeometries).toHaveBeenCalledTimes(1);
    h.service.getGisGeometries.mockResolvedValue({ status: 403, data: {} });
    await expect(h.coordinator.refresh()).rejects.toThrow();
    await expect(h.coordinator.getPrefetchSources()).rejects.toThrow('not current');
    expect(h.service.getGisGeometries).toHaveBeenCalledTimes(2);
    await h.coordinator.waitForIdle();
  });
  it('publishes metadata before coordinates and shares concurrent list and UI/background detail reads', async () => {
    const h = harness(), detail = deferred<HttpResponse<unknown>>();
    h.service.getGisGeometry.mockReturnValue(detail.promise);
    const first = h.coordinator.refresh(), second = h.coordinator.refresh();
    expect(first).toBe(second);
    await first;
    expect(h.coordinator.getSnapshot().items).toHaveLength(1);
    expect(h.coordinator.getSnapshot().records).toEqual({});
    const read = h.coordinator.ensureDetail(GEOMETRY_ID);
    const prefetch = h.coordinator.getPrefetchSources();
    expect(h.service.getGisGeometry).toHaveBeenCalledTimes(1);
    detail.resolve({ status: 200, data: geometryDetail() });
    const record = await read;
    expect(h.coordinator.getSnapshot().records[GEOMETRY_ID]).toBe(record);
    expect(await prefetch).toEqual([{ id: GEOMETRY_ID, name: 'Reference line', color: '#377eb8', sourceRevision: '1', bounds: record.bounds }]);
    await h.coordinator.waitForIdle();
  });
  it('bounds background concurrency to four and promotes queued user demand', async () => {
    const h = harness();
    const ids = Array.from({ length: 6 }, (_, i) => `12345678-1234-4234-8234-${String(i).padStart(12, '0')}`);
    const requests = ids.map(() => deferred<HttpResponse<unknown>>());
    h.service.getGisGeometries.mockResolvedValue({ status: 200, data: ids.map(id => geometryMetadata({ id })) });
    h.service.getGisGeometry.mockImplementation(async (_instance, _token, id) => requests[ids.indexOf(id)].promise);
    await h.coordinator.refresh();
    expect(h.service.getGisGeometry).toHaveBeenCalledTimes(4);
    const foreground = h.coordinator.ensureDetail(ids[5], { priority: 'foreground' });
    requests[0].resolve({ status: 200, data: geometryDetail({ id: ids[0] }) });
    await h.coordinator.ensureDetail(ids[0]);
    await vi.waitFor(() => expect(h.service.getGisGeometry.mock.calls.map(call => call[2])).toEqual(ids.slice(0, 4).concat(ids[5])));
    ids.forEach((id, i) => requests[i].resolve({ status: 200, data: geometryDetail({ id }) }));
    await foreground;
    await h.coordinator.waitForIdle();
    expect(h.coordinator.getSnapshot().loadingIds).toEqual([]);
  });
  it('cancels a UI waiter without cancelling the shared offline read', async () => {
    const h = harness(), detail = deferred<HttpResponse<unknown>>();
    h.service.getGisGeometry.mockReturnValue(detail.promise);
    await h.coordinator.refresh();
    const abort = new AbortController();
    const ui = h.coordinator.ensureDetail(GEOMETRY_ID, { signal: abort.signal });
    const offline = h.coordinator.getPrefetchSources();
    abort.abort();
    await expect(ui).rejects.toMatchObject({ name: 'AbortError' });
    detail.resolve({ status: 200, data: geometryDetail() });
    expect(await offline).toHaveLength(1);
    await h.coordinator.waitForIdle();
  });
  it('refreshes same-revision access metadata without fetching coordinates again', async () => {
    const h = harness(); await h.coordinator.refresh(); await h.coordinator.waitForIdle();
    h.service.getGisGeometries.mockResolvedValue({ status: 200, data: [geometryMetadata({ user_permission_level: 3, user_permission_level_label: 'ADMIN', can_write: true, can_delete: true, can_manage_permissions: true, modified_date: '2026-09-17T12:30:00Z' })] });
    await h.coordinator.refresh(); await h.coordinator.waitForIdle();
    expect(h.coordinator.getSnapshot().records[GEOMETRY_ID].detail.can_delete).toBe(true);
    expect(h.service.getGisGeometry).toHaveBeenCalledTimes(1);
  });
  it('removes collection omissions durably and replays revocation after process recreation', async () => {
    const h = harness(); await h.coordinator.refresh(); await h.coordinator.waitForIdle();
    h.service.getGisGeometries.mockResolvedValue({ status: 200, data: [] });
    await h.coordinator.refresh();
    expect(h.coordinator.getSnapshot().records).toEqual({});
    expect(h.revoked).toHaveBeenCalledWith([GEOMETRY_ID], 'account-a', expect.any(Function));
    const reopened = harness(); reopened.setOnline(false); await reopened.coordinator.load();
    expect(reopened.coordinator.getSnapshot().items).toEqual([]);
    expect(reopened.revoked).toHaveBeenCalledTimes(1);
    expect(await new GisGeometryCacheService(store).getDetail('account-a', GEOMETRY_ID)).toBeNull();
  });
  it('preserves cached bytes as stale on a transient list failure and rejects strict source reads', async () => {
    const h = harness(); await h.coordinator.refresh(); await h.coordinator.waitForIdle();
    h.service.getGisGeometries.mockResolvedValue({ status: 503, data: {} });
    await expect(h.coordinator.refresh()).rejects.toThrow();
    expect(h.coordinator.getSnapshot().status).toBe('stale');
    expect(h.coordinator.getSnapshot().records[GEOMETRY_ID]).toBeDefined();
    await expect(h.coordinator.getPrefetchSources()).rejects.toThrow('not current');
    h.setOnline(false);
    expect(await h.coordinator.ensureDetail(GEOMETRY_ID)).toBeDefined();
  });
  it('denies object access, removes the overlay, and revalidates collection without retrying detail', async () => {
    const h = harness();
    h.service.getGisGeometry.mockResolvedValue({ status: 404, data: '<html>not found</html>' });
    h.service.getGisGeometries.mockResolvedValueOnce({ status: 200, data: [geometryMetadata()] }).mockResolvedValue({ status: 200, data: [] });
    await h.coordinator.refresh(); await h.coordinator.waitForIdle();
    expect(h.coordinator.getSnapshot().items).toEqual([]);
    expect(h.coordinator.getSnapshot().records).toEqual({});
    expect(h.service.getGisGeometries).toHaveBeenCalledTimes(2);
    expect(h.service.getGisGeometry).toHaveBeenCalledTimes(1);
  });
  it('prevents a late old-account response from repopulating cache or snapshots', async () => {
    const h = harness(), request = deferred<HttpResponse<unknown>>();
    h.service.getGisGeometry.mockReturnValue(request.promise);
    await h.coordinator.refresh();
    const read = h.coordinator.ensureDetail(GEOMETRY_ID); const rejection = expect(read).rejects.toMatchObject({ name: 'AbortError' });
    h.coordinator.reset(); h.setSession({ token: 'other', instance: 'https://example.test', cacheScopeId: 'account-b' });
    request.resolve({ status: 200, data: geometryDetail() });
    await rejection; await h.coordinator.waitForIdle();
    expect(h.coordinator.getSnapshot().records).toEqual({});
    expect(await new GisGeometryCacheService(store).getDetail('account-a', GEOMETRY_ID)).toBeNull();
  });
  it('rejects old-revision responses and never rounds an unsafe revision', async () => {
    const h = harness();
    h.service.getGisGeometries.mockResolvedValue({ status: 200, data: [geometryMetadata({ revision: 2 })] });
    await h.coordinator.refresh(); await h.coordinator.waitForIdle();
    expect(h.coordinator.getSnapshot().records).toEqual({});
    expect(h.coordinator.getSnapshot().errors[GEOMETRY_ID]).toBeDefined();
    h.service.getGisGeometry.mockResolvedValue({ status: 200, data: geometryDetail({ revision: Number.MAX_SAFE_INTEGER + 1 }) });
    await expect(h.coordinator.ensureDetail(GEOMETRY_ID)).rejects.toThrow();
    await h.coordinator.waitForIdle();
  });
  it('recovers online from malformed saved metadata and retries failed cache loading offline', async () => {
    await store.set('projects', 'gis-geometry:account-a:catalog', { data: { schemaVersion: 999 }, cachedAt: 1 });
    const h = harness(); h.setOnline(false);
    await expect(h.coordinator.load()).rejects.toThrow();
    expect(h.coordinator.getSnapshot().status).toBe('error');
    h.setOnline(true);
    await h.coordinator.refresh(); await h.coordinator.waitForIdle();
    expect(h.coordinator.getSnapshot().records[GEOMETRY_ID]).toBeDefined();
    expect((await new GisGeometryCacheService(store).getCatalog('account-a'))?.items).toHaveLength(1);
  });
  it('accepts newer same-revision capability metadata from a detail read', async () => {
    const h = harness();
    h.service.getGisGeometry.mockResolvedValue({ status: 200, data: geometryDetail({ user_permission_level: 3, user_permission_level_label: 'ADMIN', can_write: true, can_delete: true, can_manage_permissions: true }) });
    await h.coordinator.refresh(); await h.coordinator.waitForIdle();
    expect(h.coordinator.getSnapshot().items[0].can_delete).toBe(true);
    expect(h.coordinator.getSnapshot().records[GEOMETRY_ID].detail.can_delete).toBe(true);
  });
  it('prevents an old detail access failure from undoing a newer successful collection read', async () => {
    const h = harness(), detail = deferred<HttpResponse<unknown>>();
    h.service.getGisGeometry.mockReturnValue(detail.promise);
    await h.coordinator.refresh();
    await h.coordinator.refresh();
    detail.resolve({ status: 403, data: {} });
    await h.coordinator.waitForIdle();
    expect(h.coordinator.getSnapshot().items).toHaveLength(1);
    expect(h.revoked).not.toHaveBeenCalled();
  });
  it.each([
    [403, 'collection-first'], [404, 'collection-first'],
    [403, 'denial-first'], [404, 'denial-first'],
  ] as const)('orders a newer detail %s against an older collection (%s), then allows a fresh regrant', async (status, order) => {
    const h = harness();
    await h.coordinator.refresh(); await h.coordinator.waitForIdle();
    // Retain an old durable detail while the current revision still needs coordinates.
    h.service.getGisGeometries.mockResolvedValue({ status: 200, data: [geometryMetadata({ revision: 2 })] });
    h.service.getGisGeometry.mockResolvedValueOnce({ status: 503, data: null });
    await h.coordinator.refresh(); await h.coordinator.waitForIdle();
    expect((await h.cache.getDetail('account-a', GEOMETRY_ID))?.detail.revision).toBe(1);

    const list = deferred<HttpResponse<unknown>>(), detail = deferred<HttpResponse<unknown>>();
    h.service.getGisGeometries.mockReturnValueOnce(list.promise).mockResolvedValue({ status: 200, data: [] });
    h.service.getGisGeometry.mockReturnValueOnce(detail.promise);
    const refresh = h.coordinator.refresh();
    await vi.waitFor(() => expect(h.service.getGisGeometries).toHaveBeenCalledTimes(3));
    const read = h.coordinator.ensureDetail(GEOMETRY_ID);
    const rejected = expect(read).rejects.toThrow('no longer available');
    if (order === 'collection-first') {
      list.resolve({ status: 200, data: [geometryMetadata({ revision: 2 })] });
      await refresh;
      detail.resolve({ status, data: null });
      await rejected;
    } else {
      detail.resolve({ status, data: null });
      await rejected;
      list.resolve({ status: 200, data: [geometryMetadata({ revision: 2 })] });
      await refresh;
    }
    await h.coordinator.waitForIdle();
    expect(h.coordinator.getSnapshot().items).toEqual([]);
    expect(h.coordinator.getSnapshot().records).toEqual({});
    expect((await h.cache.getCatalog('account-a'))?.items).toEqual([]);
    expect(await h.cache.getDetail('account-a', GEOMETRY_ID)).toBeNull();
    expect(h.revoked).toHaveBeenCalledWith([GEOMETRY_ID], 'account-a', expect.any(Function));
    // Two setup reads plus the denied read; the stale list must not trigger another.
    expect(h.service.getGisGeometry).toHaveBeenCalledTimes(3);

    h.service.getGisGeometries.mockResolvedValue({ status: 200, data: [geometryMetadata({ revision: 3 })] });
    h.service.getGisGeometry.mockResolvedValue({ status: 200, data: geometryDetail({ revision: 3 }) });
    await h.coordinator.refresh(); await h.coordinator.waitForIdle();
    expect(h.coordinator.getSnapshot().records[GEOMETRY_ID].detail.revision).toBe(3);
    expect((await h.cache.getCatalog('account-a'))?.revokedIds).not.toContain(GEOMETRY_ID);
  });

  it('keeps a newer denial fence when catalog persistence fails before an older collection completes', async () => {
    const h = harness();
    h.service.getGisGeometry.mockResolvedValueOnce({ status: 503, data: null });
    await h.coordinator.refresh(); await h.coordinator.waitForIdle();
    const list = deferred<HttpResponse<unknown>>(), detail = deferred<HttpResponse<unknown>>();
    h.service.getGisGeometries.mockReturnValueOnce(list.promise);
    h.service.getGisGeometry.mockReturnValueOnce(detail.promise);
    const refresh = h.coordinator.refresh();
    await vi.waitFor(() => expect(h.service.getGisGeometries).toHaveBeenCalledTimes(2));
    const read = h.coordinator.ensureDetail(GEOMETRY_ID);
    const rejected = expect(read).rejects.toThrow();
    vi.spyOn(h.cache, 'putCatalog').mockRejectedValueOnce(new Error('Storage unavailable'));
    detail.resolve({ status: 403, data: null });
    await rejected;
    list.resolve({ status: 200, data: [geometryMetadata()] });
    await refresh; await h.coordinator.waitForIdle();
    expect(h.coordinator.getSnapshot().items).toEqual([]);
    expect((await h.cache.getCatalog('account-a'))?.items).toEqual([]);
    expect(h.service.getGisGeometry).toHaveBeenCalledTimes(2);
  });

  it('keeps newer collection access when an older successful detail returns', async () => {
    const h = harness(), detail = deferred<HttpResponse<unknown>>();
    h.service.getGisGeometry.mockReturnValue(detail.promise);
    await h.coordinator.refresh();
    h.service.getGisGeometries.mockResolvedValue({ status: 200, data: [geometryMetadata({ user_permission_level: 3, user_permission_level_label: 'ADMIN', can_write: true, can_delete: true, can_manage_permissions: true })] });
    await h.coordinator.refresh();
    detail.resolve({ status: 200, data: geometryDetail() });
    await h.coordinator.waitForIdle();
    expect(h.coordinator.getSnapshot().records[GEOMETRY_ID].detail.can_delete).toBe(true);
  });
  it('repairs corrupt saved coordinates online without losing unrelated cached records', async () => {
    const h = harness(); await h.coordinator.refresh(); await h.coordinator.waitForIdle();
    await store.set('geojson', `gis-geometry:account-a:${GEOMETRY_ID}`, { data: { schemaVersion: 1, scope: 'account-a', detail: 'invalid' }, cachedAt: 1 });
    const reopened = harness(); await reopened.coordinator.load();
    expect(reopened.coordinator.getSnapshot().errors[GEOMETRY_ID]).toBeDefined();
    await reopened.coordinator.refresh(); await reopened.coordinator.waitForIdle();
    expect(reopened.coordinator.getSnapshot().records[GEOMETRY_ID]).toBeDefined();
    expect(reopened.coordinator.getSnapshot().errors[GEOMETRY_ID]).toBeUndefined();
  });
  it('restores a newer atomic detail record if shutdown interrupted its metadata publication', async () => {
    const h = harness(); await h.coordinator.refresh(); await h.coordinator.waitForIdle();
    const { parseGisGeometryDetail } = await import('../gisGeometry/validation');
    await new GisGeometryCacheService(store).putDetail('account-a', parseGisGeometryDetail(geometryDetail({ revision: 7, name: 'New revision' })));
    const reopened = harness(); reopened.setOnline(false); await reopened.coordinator.load();
    expect(reopened.coordinator.getSnapshot().items[0].revision).toBe(7);
    expect(reopened.coordinator.getSnapshot().records[GEOMETRY_ID].detail.name).toBe('New revision');
    expect(reopened.service.getGisGeometries).not.toHaveBeenCalled();
  });
  it('treats empty membership as success and requires current metadata for offline plans', async () => {
    const h = harness(); h.service.getGisGeometries.mockResolvedValue({ status: 200, data: [] });
    await h.coordinator.refresh();
    expect(await h.coordinator.getPrefetchSources()).toEqual([]);
    expect(h.coordinator.getSnapshot().status).toBe('ready');
    expect(h.service.getGisGeometry).not.toHaveBeenCalled();
    h.coordinator.cancel();
    await expect(h.coordinator.getPrefetchSources()).rejects.toThrow();
  });

  it.each([200, 403])('does not let an older collection %s erase a newer successfully loaded record', async status => {
    const h = harness();
    h.service.getGisGeometry.mockResolvedValueOnce({ status: 503, data: {} });
    await h.coordinator.refresh(); await h.coordinator.waitForIdle();
    const list = deferred<HttpResponse<unknown>>();
    h.service.getGisGeometries.mockReturnValue(list.promise);
    const refresh = h.coordinator.refresh();
    const observed = refresh.then(() => null, error => error);
    await vi.waitFor(() => expect(h.service.getGisGeometries).toHaveBeenCalledTimes(2));
    await h.coordinator.ensureDetail(GEOMETRY_ID);
    list.resolve({ status, data: [] });
    await observed; await h.coordinator.waitForIdle();
    expect(h.coordinator.getSnapshot().records[GEOMETRY_ID]).toBeDefined();
    expect(h.coordinator.getSnapshot().items).toHaveLength(1);
    expect(h.revoked).not.toHaveBeenCalledWith([GEOMETRY_ID], expect.anything(), expect.anything());
  });

});
