import type { SpeleoDBService } from '../services/SpeleoDBService';
import { GisGeometryCacheService, type GisGeometryCatalog } from '../services/GisGeometryCacheService';
import type { StoredSession } from '../services/SecureSessionStore';
import { EMPTY_GIS_GEOMETRY_SNAPSHOT, type GisGeometryMapRecord, type GisGeometryMetadata, type GisGeometryPrefetchSource, type GisGeometryPrefetchSnapshot, type GisGeometrySnapshot } from '../types/gisGeometry';
import { isGisGeometryId, parseGisGeometryDetail, parseGisGeometryList } from '../gisGeometry/validation';
import { createAbortError, isAbortError, throwIfAborted } from '../utils/abort';

interface Dependencies {
  service: Pick<SpeleoDBService, 'getGisGeometries' | 'getGisGeometry'>;
  cache?: GisGeometryCacheService;
  getSession(): StoredSession | null;
  hasNetworkAccess(): boolean;
  onRevoked?(ids: string[], scope: string, validate: () => void): Promise<void> | void;
}
interface DetailTask {
  id: string;
  priority: 'foreground' | 'background';
  promise: Promise<GisGeometryMapRecord>;
  resolve(record: GisGeometryMapRecord): void;
  reject(error: unknown): void;
  started: boolean;
}
const UNAVAILABLE = 'This geometry is no longer available.';
const RETRY = 'GIS Geometry could not be loaded. Try again.';
const OFFLINE = 'This geometry is not saved on this device. Go online to load it.';

/** Account-scoped authority for metadata, revisioned detail, and shared UI/offline reads. */
export class GisGeometryCoordinator {
  private readonly cache: GisGeometryCacheService;
  private snapshot: GisGeometrySnapshot = EMPTY_GIS_GEOMETRY_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private catalog: GisGeometryCatalog | null = null;
  private context = new AbortController();
  private generation = 0;
  private refreshGeneration = 0;
  private readonly epochs = new Map<string, number>();
  private refreshPromise: Promise<void> | null = null;
  private loadPromise: Promise<void> | null = null;
  private readonly tasks = new Map<string, DetailTask>();
  private readonly running = new Set<Promise<unknown>>();
  private workers = 0;
  private commitTail: Promise<void> = Promise.resolve();
  private currentMetadata = false;
  private refreshAttempted = false;
  private nextAccessRead = 0;
  private readonly accessReads = new Map<string, number>();
  private readonly revalidatedDenials = new Set<string>();

  constructor(private readonly dependencies: Dependencies) { this.cache = dependencies.cache ?? new GisGeometryCacheService(); }
  getSnapshot = (): GisGeometrySnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };

  private publish(patch: Partial<GisGeometrySnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) { try { listener(); } catch { /* Observers cannot undo durable truth. */ } }
  }
  private session(): StoredSession & { cacheScopeId: string } {
    const session = this.dependencies.getSession();
    if (!session?.cacheScopeId) throw createAbortError('No GIS Geometry account scope.');
    if (this.snapshot.scope !== session.cacheScopeId) {
      this.reset();
      this.publish({ scope: session.cacheScopeId });
    }
    return session as StoredSession & { cacheScopeId: string };
  }
  private assertCurrent(scope: string, generation: number): void {
    throwIfAborted(this.context.signal);
    if (this.generation !== generation || this.dependencies.getSession()?.cacheScopeId !== scope || this.snapshot.scope !== scope) throw createAbortError('GIS Geometry request superseded.');
  }
  private commit<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.commitTail.then(operation);
    this.commitTail = result.then(() => {}, () => {});
    return result;
  }
  private track<T>(promise: Promise<T>): Promise<T> {
    this.running.add(promise);
    void promise.then(() => this.running.delete(promise), () => this.running.delete(promise));
    return promise;
  }

  load(): Promise<void> {
    const session = this.session();
    if (this.loadPromise) return this.loadPromise;
    const generation = this.generation;
    const validate = () => this.assertCurrent(session.cacheScopeId, generation);
    const operation = this.track((async () => {
      // Cleanup retries must retain accepted runtime authority: a failed
      // catalog write can leave older, already-revoked membership on disk.
      const catalog = this.catalog ?? await this.cache.getCatalog(session.cacheScopeId);
      validate();
      if (!catalog) return;
      this.catalog = catalog;
      this.publish({ items: catalog.items, status: 'stale' });
      if (catalog.revokedIds.length) {
        await this.cleanupRevoked(catalog, this.context.signal, validate);
      }
      const records: Record<string, GisGeometryMapRecord> = {};
      const errors: Record<string, string> = {};
      const restored = new Map(catalog.items.map(item => [item.id, item]));
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(4, catalog.items.length) }, async () => {
        while (cursor < catalog.items.length) {
          const item = catalog.items[cursor++];
          try {
            const record = await this.cache.getDetail(catalog.scope, item.id);
            validate();
            if (record && record.detail.revision >= item.revision) {
              const metadata = record.detail.revision === item.revision ? item : this.withAccess(this.metadata(record), item);
              restored.set(item.id, metadata);
              records[item.id] = this.withMetadata(record, metadata);
            }
          } catch (error) {
            if (isAbortError(error)) throw error;
            validate();
            errors[item.id] = 'Saved GIS Geometry could not be read. Try again.';
          }
        }
      }));
      validate();
      this.publish({ items: [...restored.values()], records, errors });
    })());
    this.loadPromise = operation;
    void operation.catch(error => {
      if (this.loadPromise === operation) this.loadPromise = null;
      if (!isAbortError(error) && generation === this.generation) {
        this.publish({ status: 'error', error: 'Saved GIS Geometries could not be read. Try again.' });
      }
    });
    return operation;
  }

  refresh(): Promise<void> {
    const session = this.session();
    // Concurrent startup/panel/sync callers share the same collection read.
    if (this.refreshPromise) return this.refreshPromise;
    const generation = this.generation, refreshGeneration = ++this.refreshGeneration;
    const signal = this.context.signal;
    const validate = () => { this.assertCurrent(session.cacheScopeId, generation); if (refreshGeneration !== this.refreshGeneration) throw createAbortError(); };
    const operation = this.track((async () => {
      try {
        try { await this.load(); } catch (error) {
          if (isAbortError(error) || !this.dependencies.hasNetworkAccess()) throw error;
          // Fresh authenticated metadata can repair corrupt or unreadable cached data.
        }
        validate();
        if (!this.dependencies.hasNetworkAccess()) { this.publish({ status: 'stale' }); return; }
        this.currentMetadata = false;
        this.refreshAttempted = true;
        this.publish({ status: 'loading', error: null });
        const readSequence = ++this.nextAccessRead;
        const response = await this.dependencies.service.getGisGeometries(session.instance, session.token, { signal });
        validate();
        if (response.status === 403 || response.status === 401) {
          await this.revoke(this.snapshot.items.map(item => item.id), session.cacheScopeId, generation, readSequence);
          throw new Error('GIS Geometry access could not be verified.');
        }
        if (response.status !== 200) throw new Error(RETRY);
        const received = parseGisGeometryList(response.data);
        await this.commit(async () => {
          validate();
          const prior = new Map(this.snapshot.items.map(item => [item.id, item]));
          // A delayed collection cannot restore membership revoked by a later read.
          const items = received.filter(item => prior.has(item.id)
            || readSequence >= (this.accessReads.get(item.id) ?? 0)).map(item => {
            const old = prior.get(item.id);
            let merged = old && old.revision > item.revision ? { ...item, name: old.name, color: old.color, geometry_type: old.geometry_type, revision: old.revision } : item;
            if (old && readSequence < (this.accessReads.get(item.id) ?? 0)) merged = this.withAccess(merged, old);
            return merged;
          });
          // A collection begun before a newer successful detail read cannot revoke it.
          const receivedIds = new Set(items.map(item => item.id));
          for (const item of this.snapshot.items) {
            if (!receivedIds.has(item.id) && readSequence < (this.accessReads.get(item.id) ?? 0)) items.push(item);
          }
          const membership = new Set(items.map(item => item.id));
          const removed = this.snapshot.items.filter(item => !membership.has(item.id)).map(item => item.id);
          const revokedIds = [...new Set([...(this.catalog?.revokedIds ?? []), ...removed])].filter(id => !membership.has(id));
          const catalog: GisGeometryCatalog = { schemaVersion: 1, scope: session.cacheScopeId, items, revokedIds };
          // An authenticated omission revokes usable access immediately, even
          // when the independent persistence work fails.
          if (removed.length) this.applyRevocation(removed, session.cacheScopeId, readSequence);
          await this.persistMembership(catalog, signal, validate);
          validate();
          this.catalog = catalog;
          for (const item of items) if (readSequence >= (this.accessReads.get(item.id) ?? 0)) this.accessReads.set(item.id, readSequence);
          const records: Record<string, GisGeometryMapRecord> = {};
          for (const item of items) {
            const record = this.snapshot.records[item.id];
            if (record?.detail.revision === item.revision) records[item.id] = this.withMetadata(record, item);
          }
          this.currentMetadata = true;
          this.publish({ items, records, status: 'ready', error: null });
        });
        validate();
        for (const item of this.snapshot.items) void this.ensureDetail(item.id, { priority: 'background' }).catch(() => {});
      } catch (error) {
        if (isAbortError(error)) throw error;
        validate();
        this.currentMetadata = false;
        this.publish({ status: this.snapshot.items.length ? 'stale' : 'error', error: 'GIS Geometries could not be refreshed. Try again.' });
        throw new Error('GIS Geometries could not be refreshed. Try again.');
      }
    })());
    this.refreshPromise = operation;
    void operation.then(() => { if (this.refreshPromise === operation) this.refreshPromise = null; }, () => { if (this.refreshPromise === operation) this.refreshPromise = null; });
    return operation;
  }

  ensureDetail(id: string, options: { signal?: AbortSignal; priority?: 'foreground' | 'background' } = {}): Promise<GisGeometryMapRecord> {
    throwIfAborted(options.signal);
    this.session();
    if (!isGisGeometryId(id)) return Promise.reject(new Error(UNAVAILABLE));
    const item = this.snapshot.items.find(value => value.id === id);
    if (!item) return Promise.reject(new Error(UNAVAILABLE));
    const cached = this.snapshot.records[id];
    if (cached?.detail.revision === item.revision) return Promise.resolve(cached);
    let task = this.tasks.get(id);
    if (!task) {
      let resolve!: DetailTask['resolve'], reject!: DetailTask['reject'];
      const promise = new Promise<GisGeometryMapRecord>((res, rej) => { resolve = res; reject = rej; });
      task = { id, priority: options.priority ?? 'foreground', promise, resolve, reject, started: false };
      this.tasks.set(id, task);
      this.publish({ loadingIds: [...this.tasks.keys()] });
      this.pump();
    } else if (options.priority === 'foreground') task.priority = 'foreground';
    return this.waitForCaller(task.promise, options.signal);
  }

  private pump(): void {
    while (this.workers < 4) {
      const pending = [...this.tasks.values()].filter(task => !task.started);
      const task = pending.find(value => value.priority === 'foreground') ?? pending[0];
      if (!task) return;
      task.started = true;
      this.workers++;
      const generation = this.generation;
      const work = this.fetchDetail(task.id).then(task.resolve, task.reject).finally(() => {
        this.workers--;
        if (generation !== this.generation) { this.pump(); return; }
        if (this.tasks.get(task.id) === task) this.tasks.delete(task.id);
        this.publish({ loadingIds: [...this.tasks.keys()] });
        this.pump();
      });
      this.track(work);
    }
  }

  private async fetchDetail(id: string): Promise<GisGeometryMapRecord> {
    const session = this.session(), generation = this.generation, epoch = this.epochs.get(id) ?? 0;
    const signal = this.context.signal;
    const validate = () => {
      this.assertCurrent(session.cacheScopeId, generation);
      if ((this.epochs.get(id) ?? 0) !== epoch || !this.snapshot.items.some(item => item.id === id)) throw createAbortError();
    };
    const validateScope = () => this.assertCurrent(session.cacheScopeId, generation);
    try {
      if (!this.dependencies.hasNetworkAccess()) throw new Error(OFFLINE);
      const readSequence = ++this.nextAccessRead;
      const response = await this.dependencies.service.getGisGeometry(session.instance, session.token, id, { signal });
      validate();
      if (response.status === 403 || response.status === 404 || response.status === 401) {
        if (!await this.revoke([id], session.cacheScopeId, generation, readSequence)) {
          throw createAbortError('A newer access read superseded this failure.');
        }
        // One metadata revalidation per denied identity, never an automatic retry loop.
        if (!this.revalidatedDenials.has(id)) {
          this.revalidatedDenials.add(id);
          void Promise.resolve(this.refreshPromise).then(() => { validateScope(); return this.refresh(); }).catch(() => {});
        }
        throw new Error(UNAVAILABLE);
      }
      if (response.status !== 200) throw new Error(RETRY);
      const incoming = parseGisGeometryDetail(response.data, id);
      return await this.commit(async () => {
        validate();
        const item = this.snapshot.items.find(value => value.id === id)!;
        if (incoming.detail.revision < item.revision) throw new Error('A newer geometry version is available. Try again.');
        let record = readSequence < (this.accessReads.get(id) ?? 0)
          ? this.withMetadata(incoming, this.withAccess(this.metadata(incoming), item)) : incoming;
        const accepted = await this.cache.putDetail(session.cacheScopeId, record, signal, validate);
        validate();
        if (accepted !== record) {
          // An interrupted catalog write can leave newer content on disk. Keep
          // that content, but never restore its older access metadata over this
          // accepted read. Persist both together before publishing membership.
          record = this.withMetadata(accepted, this.withAccess(this.metadata(accepted), record.detail));
          record = await this.cache.putDetail(session.cacheScopeId, record, signal, validate);
          validate();
        }
        const items = this.snapshot.items.map(value => value.id === id ? this.metadata(record) : value);
        const catalog: GisGeometryCatalog = { schemaVersion: 1, scope: session.cacheScopeId, items, revokedIds: this.catalog?.revokedIds ?? [] };
        await this.cache.putCatalog(catalog, signal, validate);
        validate();
        this.catalog = catalog;
        if (readSequence >= (this.accessReads.get(id) ?? 0)) this.accessReads.set(id, readSequence);
        this.revalidatedDenials.delete(id);
        const errors = { ...this.snapshot.errors }; delete errors[id];
        this.publish({ items, records: { ...this.snapshot.records, [id]: record }, errors });
        return record;
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      this.assertCurrent(session.cacheScopeId, generation);
      if ((this.epochs.get(id) ?? 0) === epoch) this.publish({ errors: { ...this.snapshot.errors, [id]: error instanceof Error && [OFFLINE, UNAVAILABLE].includes(error.message) ? error.message : RETRY } });
      throw new Error(error instanceof Error && [OFFLINE, UNAVAILABLE].includes(error.message) ? error.message : RETRY);
    }
  }

  private revoke(ids: string[], scope: string, generation: number, readSequence: number): Promise<boolean> {
    return this.commit(async () => {
      const validate = () => this.assertCurrent(scope, generation);
      validate();
      const currentIds = ids.filter(id => readSequence >= (this.accessReads.get(id) ?? 0));
      if (!currentIds.length) {
        // A previous denial may have removed runtime membership before its
        // durable cleanup failed. Explicit denied refreshes must retry it.
        if (this.catalog?.revokedIds.length) await this.persistMembership(this.catalog, this.context.signal, validate);
        return false;
      }
      const catalog = this.applyRevocation(currentIds, scope, readSequence);
      await this.persistMembership(catalog, this.context.signal, validate);
      return true;
    });
  }

  private applyRevocation(ids: string[], scope: string, readSequence: number): GisGeometryCatalog {
    const removing = new Set(ids);
    const items = this.snapshot.items.filter(item => !removing.has(item.id));
    const catalog: GisGeometryCatalog = { schemaVersion: 1, scope, items,
      revokedIds: [...new Set([...(this.catalog?.revokedIds ?? []), ...ids])] };
    for (const id of ids) {
      this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1);
      this.accessReads.set(id, readSequence);
      // A later regrant must not share a task from the revoked access epoch.
      // Its underlying work remains tracked and fenced until it settles.
      const task = this.tasks.get(id);
      if (task) {
        this.tasks.delete(id);
        if (!task.started) task.reject(new Error(UNAVAILABLE));
      }
    }
    const records = { ...this.snapshot.records };
    for (const id of ids) delete records[id];
    this.catalog = catalog;
    this.currentMetadata = false;
    this.publish({ items, records, loadingIds: [...this.tasks.keys()] });
    return catalog;
  }

  /** Retain the in-memory denial and attempt every independent cleanup on failure. */
  private async persistMembership(catalog: GisGeometryCatalog, signal: AbortSignal, validate: () => void): Promise<void> {
    let failure: unknown;
    try { await this.cache.putCatalog(catalog, signal, validate); } catch (error) { failure = error; }
    validate();
    if (catalog.revokedIds.length) {
      try { await this.cleanupRevoked(catalog, signal, validate); } catch (error) { failure ??= error; }
      validate();
    }
    if (failure) {
      this.currentMetadata = false;
      this.publish({ status: 'error', error: 'GIS Geometry access changes could not be saved. Try again.' });
      throw failure;
    }
  }

  private async cleanupRevoked(catalog: GisGeometryCatalog, signal: AbortSignal, validate: () => void): Promise<void> {
    let failure: unknown;
    try { await this.cache.removeDetails(catalog.scope, catalog.revokedIds, signal); } catch (error) { failure = error; }
    validate();
    try { await this.dependencies.onRevoked?.(catalog.revokedIds, catalog.scope, validate); } catch (error) { failure ??= error; }
    validate();
    if (failure) throw failure;
  }

  async getPrefetchSources(signal?: AbortSignal): Promise<GisGeometryPrefetchSource[]> {
    const snapshot = await this.getPrefetchSnapshot(signal);
    if (!snapshot.complete) throw new Error('GIS Geometry metadata is not current.');
    if (snapshot.retainedSourceKeys.length) throw new Error(RETRY);
    return snapshot.sources;
  }

  /** Partial coordinate failures must not block other automatic area sources. */
  async getPrefetchSnapshot(
    signal?: AbortSignal,
    options: { refresh?: boolean } = {},
  ): Promise<GisGeometryPrefetchSnapshot> {
    throwIfAborted(signal);
    const session = this.session(), generation = this.generation;
    const validate = () => {
      throwIfAborted(signal);
      this.assertCurrent(session.cacheScopeId, generation);
    };
    const incomplete = (): GisGeometryPrefetchSnapshot => ({ sources: [], complete: false, retainedSourceKeys: [], isCurrent: () => false });
    try {
      if (options.refresh || (!this.refreshPromise && !this.refreshAttempted)) {
        await this.waitForCaller(this.refresh(), signal);
      } else if (this.refreshPromise) {
        await this.waitForCaller(this.refreshPromise, signal);
      }
    } catch {
      // Account/caller cancellation is terminal. A failed collection preserves
      // its prior family without denying healthy projects, tracks or overlays.
      validate();
      return incomplete();
    }
    validate();
    if (!this.currentMetadata) return incomplete();
    const collectionGeneration = this.refreshGeneration;
    const items = this.snapshot.items;
    await Promise.allSettled(items.map(item => this.ensureDetail(item.id, { signal, priority: 'background' })));
    validate();
    // A concurrent refresh or access denial invalidates collection authority,
    // not the caller's unrelated tile work. Revocations are removed separately.
    if (!this.currentMetadata || collectionGeneration !== this.refreshGeneration) return incomplete();
    const sources: GisGeometryPrefetchSource[] = [];
    const retainedSourceKeys: string[] = [];
    for (const item of this.snapshot.items) {
      const record = this.snapshot.records[item.id];
      if (!record || record.detail.revision !== item.revision) {
        retainedSourceKeys.push(`gis-geometry:${item.id}`);
      } else {
        sources.push({ id: item.id, name: item.name, color: item.color, sourceRevision: String(item.revision), bounds: record.bounds });
      }
    }
    const revisions = new Map(this.snapshot.items.map(item => [item.id, item.revision]));
    const isCurrent = () => !signal?.aborted && !this.context.signal.aborted
      && this.generation === generation && this.currentMetadata
      && this.dependencies.getSession()?.cacheScopeId === session.cacheScopeId
      && this.snapshot.scope === session.cacheScopeId
      && this.snapshot.items.length === revisions.size
      && this.snapshot.items.every(item => revisions.get(item.id) === item.revision);
    return { sources, complete: true, retainedSourceKeys, isCurrent };
  }

  reportError(): void {
    this.currentMetadata = false;
    this.publish({ status: 'error', error: 'GIS Geometries could not be prepared for this account. Try again.' });
  }

  cancel(): void {
    this.context.abort(createAbortError());
    this.context = new AbortController();
    this.generation++;
    this.refreshGeneration++;
    for (const task of this.tasks.values()) task.reject(createAbortError());
    this.tasks.clear();
    this.refreshPromise = null;
    this.loadPromise = null;
    this.currentMetadata = false;
    this.publish({ loadingIds: [] });
  }
  reset(): void {
    this.cancel();
    this.catalog = null;
    this.refreshAttempted = false;
    this.epochs.clear();
    this.accessReads.clear();
    this.revalidatedDenials.clear();
    this.snapshot = EMPTY_GIS_GEOMETRY_SNAPSHOT;
    this.publish({});
  }
  async waitForIdle(): Promise<void> {
    while (this.running.size) await Promise.allSettled([...this.running]);
    await this.commitTail;
  }
  async clearScope(scope: string): Promise<void> { await this.cache.clearScope(scope); }
  private withAccess(metadata: GisGeometryMetadata, access: GisGeometryMetadata): GisGeometryMetadata {
    return { ...metadata, user_permission_level: access.user_permission_level,
      user_permission_level_label: access.user_permission_level_label, can_write: access.can_write,
      can_delete: access.can_delete, can_manage_permissions: access.can_manage_permissions,
      modified_date: Date.parse(access.modified_date) > Date.parse(metadata.modified_date) ? access.modified_date : metadata.modified_date };
  }
  private metadata(record: GisGeometryMapRecord): GisGeometryMetadata {
    // Strict parser strips detail-only keys from metadata persistence.
    return parseGisGeometryList([record.detail])[0];
  }
  private withMetadata(record: GisGeometryMapRecord, metadata: GisGeometryMetadata): GisGeometryMapRecord {
    return { ...record, detail: { ...record.detail, ...metadata }, feature: { ...record.feature, properties: { name: metadata.name } } };
  }
  private waitForCaller<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
      const aborted = () => { cleanup(); reject(signal.reason ?? createAbortError()); };
      const cleanup = () => signal.removeEventListener('abort', aborted);
      signal.addEventListener('abort', aborted, { once: true });
      void promise.then(value => { cleanup(); if (!signal.aborted) resolve(value); }, error => { cleanup(); if (!signal.aborted) reject(error); });
    });
  }
}
