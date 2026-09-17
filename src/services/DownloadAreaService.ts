import { chooseDownloadAreaColor } from './downloadAreaColors';
import { MAP_LAYERS } from '../constants';
import {
  DownloadAreaType,
  EMPTY_DOWNLOAD_AREAS,
  type DownloadArea,
  type DownloadAreaCatalog,
  type DownloadAreaInput,
  type DownloadAreaProgress,
  type DownloadAreasSnapshot,
  type ManualDownloadAreaInput,
  type AutomaticDownloadAreaSource,
} from '../types/downloadArea';
import type { MapLayerId } from '../types/mapLayer';
import type {
  OfflineMapLayerProgress,
  OfflineMapPlanningInput,
  OfflineMapSyncSnapshot,
} from '../types/offlineMapSync';
import { isAbortError } from '../utils/abort';
import {
  countAreaCoordinates,
  MAX_AREA_COORDINATES,
  AREA_MIN_ZOOM,
  AREA_MAX_ZOOM,
} from './downloadAreaGeometry';
import { downloadCoverage, downloadLayers } from './downloadCoverage';
import {
  EMPTY_OFFLINE_MAP_SYNC_SNAPSHOT,
  OfflineMapSyncStore,
} from './OfflineMapSyncStore';
import type { OfflineMapSyncEngineLike } from './OfflineMapSyncEngine';

type LayerState = {
  key: string;
  status: DownloadAreaProgress['status'];
  progress: OfflineMapLayerProgress;
  refreshAfter: number;
};

/** One geometry union, one bounded downloader, independent layer lifetimes. */
export class DownloadAreaService {
  private snapshot: DownloadAreasSnapshot = EMPTY_DOWNLOAD_AREAS;
  private listeners = new Set<() => void>();
  private syncStore = new OfflineMapSyncStore();
  private coverage = downloadCoverage([]);
  private layerIds: readonly MapLayerId[] = ['esri-satellite'];
  private layers = new Map<string, LayerState>();
  private counts = new Map<string, number>();
  private readyAreas = new Map<
    string,
    { revision: number; layers: Set<string> }
  >();
  private coordinateCount: number | null = null;
  private plan: Promise<OfflineMapPlanningInput> | null = null;
  private queue = new Map<string, boolean>();
  private draining: Promise<void> | null = null;
  private current: {
    layerId: string;
    key: string;
    abort: AbortController;
  } | null = null;
  private disposed = false;
  private loaded: Promise<void> | null = null;
  private unsubscribe: () => void;
  private sourceReconciled = false;
  private foreground = true;
  private maintenance = new Set<Promise<void>>();

  constructor(
    private engine: OfflineMapSyncEngineLike,
    private online: () => boolean,
    private preferredLayers?: () => MapLayerId[],
  ) {
    this.unsubscribe = engine.subscribe(() => this.receiveProgress());
  }
  getSnapshot = (): DownloadAreasSnapshot => this.snapshot;
  getSyncSnapshot = (): OfflineMapSyncSnapshot => this.syncStore.getSnapshot();
  subscribeSync = (listener: () => void): (() => void) =>
    this.syncStore.subscribe(listener);
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(update: Partial<DownloadAreasSnapshot>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...update };
    for (const listener of this.listeners) listener();
  }
  preload(): Promise<void> {
    if (!this.loaded)
      this.loaded = this.restore().catch((error) => {
        this.loaded = null;
        this.publish({ error: 'Offline map settings could not be loaded.' });
        throw error;
      });
    return this.loaded;
  }
  private async restore(): Promise<void> {
    await this.engine.preload();
    if (this.disposed) return;
    const { readDownloadAreaCatalog, mutateDownloadAreaCatalog } =
      await import('./tileCache/DownloadAreaRepository');
    let catalog = await readDownloadAreaCatalog();
    const layerIds = this.preferredLayers?.() ?? [...downloadLayers(catalog)];
    if (
      JSON.stringify(catalog.layerIds) !== JSON.stringify(layerIds) ||
      catalog.areas.some(
        (area) => JSON.stringify(area.layerIds) !== JSON.stringify(layerIds),
      )
    ) {
      catalog = await mutateDownloadAreaCatalog((current) => {
        this.assertActive();
        return {
          ...current,
          layerIds,
          areas: current.areas.map((area) => ({ ...area, layerIds })),
        };
      });
    }
    if (this.disposed) return;
    this.adoptCatalog(catalog);
    await this.readCoverage();
  }
  private adoptCatalog(catalog: DownloadAreaCatalog): void {
    const next = downloadCoverage(catalog.areas);
    if (next.key !== this.coverage.key) {
      this.coverage = next;
      this.coordinateCount = null;
      this.plan = null;
    }
    this.layerIds = downloadLayers(catalog);
    this.counts = new Map(
      catalog.areas.map((area) => [area.areaId, countAreaCoordinates(area)]),
    );
    this.readyAreas = new Map(
      catalog.areas.map((area) => [
        area.areaId,
        this.readyAreas.get(area.areaId)?.revision === area.revision
          ? this.readyAreas.get(area.areaId)!
          : { revision: area.revision, layers: new Set<string>() },
      ]),
    );
    for (const ready of this.readyAreas.values()) {
      for (const id of ready.layers)
        if (!this.layerIds.some((layer) => layer === id))
          ready.layers.delete(id);
    }
    this.publish({ areas: catalog.areas, enabledLayerIds: this.layerIds });
    for (const id of this.queue.keys())
      if (!this.layerIds.some((layer) => layer === id)) this.queue.delete(id);
    for (const id of this.layers.keys())
      if (!this.layerIds.some((layer) => layer === id)) this.layers.delete(id);
    if (
      this.current &&
      (this.current.key !== next.key ||
        !this.layerIds.some((id) => id === this.current!.layerId))
    ) {
      this.current.abort.abort();
    }
    this.publishProgress();
  }
  private async readCoverage(): Promise<void> {
    const { getOfflineMapGenerations } =
      await import('./tileCache/TileCacheRepository');
    const generations = await getOfflineMapGenerations();
    if (this.disposed) return;
    for (const layerId of this.layerIds) {
      const active = generations.find(
        (g) =>
          g.status === 'active' &&
          g.layerId === layerId &&
          g.coverageKey === this.coverage.key &&
          g.completedTiles === g.totalTiles &&
          g.failedTiles === 0,
      );
      const existing = this.layers.get(layerId);
      if (active) this.markAreasReady(layerId);
      if (active && (!existing || existing.key !== this.coverage.key)) {
        this.coordinateCount = active.totalTiles;
        this.layers.set(layerId, {
          key: this.coverage.key,
          status: 'downloaded',
          refreshAfter: active.refreshAfter,
          progress: {
            ...this.emptyProgress(layerId, active.totalTiles),
            completedTiles: active.completedTiles,
            cachedFreshTiles: active.completedTiles,
            usableTiles: active.completedTiles,
          },
        });
      }
    }
    this.publish({
      availableLayerIds: [
        ...new Set(
          generations
            .filter((g) => g.status === 'active' && g.completedTiles > 0)
            .map((g) => g.layerId),
        ),
      ],
    });
    this.publishProgress();
  }
  async saveManual(
    input: ManualDownloadAreaInput,
    areaId?: string,
  ): Promise<string> {
    await this.preload();
    if (countAreaCoordinates(input) > MAX_AREA_COORDINATES)
      throw new Error(
        'Choose a smaller area. This selection is too large to download.',
      );
    const previousRevision = this.snapshot.areas.find(
      (area) => area.areaId === areaId,
    )?.revision;
    const id = areaId ?? crypto.randomUUID();
    const { mutateDownloadAreaCatalog } =
      await import('./tileCache/DownloadAreaRepository');
    const catalog = await mutateDownloadAreaCatalog((current) => {
      this.assertActive();
      const previous = current.areas.find((area) => area.areaId === id);
      if (areaId && (!previous || previous.type !== DownloadAreaType.Manual))
        throw new Error('Only saved manual areas can be edited.');
      const candidate: DownloadAreaInput = {
        topLeft: input.topLeft,
        bottomRight: input.bottomRight,
        color: previous?.color ?? chooseDownloadAreaColor(current.areas),
        objectId: null,
        type: DownloadAreaType.Manual,
        visible: previous?.visible ?? true,
        sourceKey: `manual:${id}`,
        sourceRevision: null,
        layerIds: [...downloadLayers(current)],
      };
      const area = this.updatedArea(previous, candidate, id);
      return {
        ...current,
        areas: previous
          ? current.areas.map((value) => (value.areaId === id ? area : value))
          : [...current.areas, area],
      };
    });
    this.adoptCatalog(catalog);
    await this.readCoverage();
    if (
      catalog.areas.find((area) => area.areaId === id)?.revision !==
        previousRevision ||
      this.snapshot.progress[id]?.status !== 'downloaded'
    )
      this.resume();
    return id;
  }
  async setVisible(areaId: string, visible: boolean): Promise<void> {
    await this.preload();
    const { mutateDownloadAreaCatalog } =
      await import('./tileCache/DownloadAreaRepository');
    const catalog = await mutateDownloadAreaCatalog((current) => {
      this.assertActive();
      const area = current.areas.find((value) => value.areaId === areaId);
      if (!area || area.type !== DownloadAreaType.Manual)
        throw new Error('Only manual areas can be shown.');
      return {
        ...current,
        areas: current.areas.map((value) =>
          value.areaId === areaId ? { ...value, visible } : value,
        ),
      };
    });
    this.publish({ areas: catalog.areas });
  }
  async deleteManual(areaId: string): Promise<void> {
    await this.preload();
    const { mutateDownloadAreaCatalog } =
      await import('./tileCache/DownloadAreaRepository');
    const catalog = await mutateDownloadAreaCatalog((current) => {
      this.assertActive();
      if (
        !current.areas.some(
          (area) =>
            area.areaId === areaId && area.type === DownloadAreaType.Manual,
        )
      )
        throw new Error('Only manual areas can be deleted.');
      return {
        ...current,
        areas: current.areas.filter((area) => area.areaId !== areaId),
      };
    });
    this.adoptCatalog(catalog);
    this.resume();
    await this.cleanupReleased();
    await this.readCoverage();
    await this.engine.refreshCacheStats?.();
  }
  async reconcileAutomatic(
    inputs: DownloadAreaInput[],
    validate: () => void = () => {},
    forceRefresh = false,
  ): Promise<void> {
    const types = Object.values(DownloadAreaType).filter(
      (type) => type !== DownloadAreaType.Manual,
    );
    if (inputs.some((input) => input.type === DownloadAreaType.Manual ||
      !Object.values(DownloadAreaType).includes(input.type)))
      throw new Error('Automatic sources must contain automatic download areas.');
    return this.reconcileAutomaticSources(types.map((type) => ({
      type,
      inputs: inputs.filter((input) => input.type === type),
      complete: true,
    })), validate, forceRefresh);
  }
  /** Merge source authority without converting an unreadable family to empty intent. */
  async reconcileAutomaticSources(
    sources: readonly AutomaticDownloadAreaSource[],
    validate: () => void = () => {},
    forceRefresh = false,
  ): Promise<void> {
    const types = new Set<DownloadAreaType>(sources.map((source) => source.type));
    if (types.size !== sources.length || types.has(DownloadAreaType.Manual) || sources.some((source) =>
      !Object.values(DownloadAreaType).includes(source.type) ||
      source.inputs.some((input) => input.type !== source.type),
    )) throw new Error('Automatic download areas must belong to one source type.');
    await this.preload();
    const { mutateDownloadAreaCatalog } =
      await import('./tileCache/DownloadAreaRepository');
    let complete = false;
    let unresolved = false;
    const catalog = await mutateDownloadAreaCatalog((current) => {
      this.assertActive();
      validate();
      const layerIds = [...downloadLayers(current)];
      const authoritative = new Set<DownloadAreaType>();
      const areas = current.areas.filter((area) =>
        area.type === DownloadAreaType.Manual || !types.has(area.type),
      );
      for (const source of sources) {
        const old = new Map(current.areas.filter((area) => area.type === source.type)
          .map((area) => [area.sourceKey, area]));
        // The repository invokes this callback after its last asynchronous read.
        // A revoked or superseded source cannot sneak back into the shared union.
        if (source.isCurrent?.() === false) {
          areas.push(...old.values());
          unresolved = true;
          continue;
        }
        const retained = new Set(source.retainedSourceKeys);
        const unique = new Map(source.inputs.map((input) => [input.sourceKey, input]));
        for (const [key, area] of old) {
          if (!unique.has(key) && (!source.complete || retained.has(key))) areas.push(area);
        }
        for (const input of unique.values())
          areas.push(this.updatedArea(old.get(input.sourceKey), { ...input, layerIds }));
        if (source.complete && retained.size === 0) authoritative.add(source.type);
        else unresolved = true;
      }
      complete = Object.values(DownloadAreaType).every((type) =>
        type === DownloadAreaType.Manual || authoritative.has(type),
      );
      return {
        ...current,
        layerIds,
        areas,
      };
    });
    this.sourceReconciled = complete;
    this.adoptCatalog(catalog);
    if (unresolved) this.reportAutomaticError();
    else this.publish({ error: null });
    await this.cleanupReleased();
    await this.readCoverage();
    this.resume(forceRefresh);
    // A complete read may confirm the same union already downloaded by a partial
    // read, so no new drain would otherwise retire legacy ownership.
    await this.retireLegacyCoverage();
  }
  /** Remove confirmed inaccessible geometry without collecting other sources. */
  async removeGisGeometrySources(
    ids: readonly string[],
    validate: () => void = () => {},
  ): Promise<void> {
    if (!ids.length) return;
    const removed = new Set(ids);
    await this.preload();
    const { mutateDownloadAreaCatalog } =
      await import('./tileCache/DownloadAreaRepository');
    const catalog = await mutateDownloadAreaCatalog((current) => {
      this.assertActive();
      validate();
      return {
        ...current,
        areas: current.areas.filter((area) =>
          area.type !== DownloadAreaType.GisGeometry ||
          area.objectId === null || !removed.has(area.objectId),
        ),
      };
    });
    this.adoptCatalog(catalog);
    this.resume();
    await this.cleanupReleased();
    await this.readCoverage();
    await this.engine.refreshCacheStats?.();
  }
  async setLayers(layerIds: MapLayerId[]): Promise<void> {
    const restored = Boolean(this.loaded);
    let added: string[] = [];
    await this.preload();
    const { mutateDownloadAreaCatalog } =
      await import('./tileCache/DownloadAreaRepository');
    const catalog = await mutateDownloadAreaCatalog((current) => {
      this.assertActive();
      added = layerIds.filter((id) => !downloadLayers(current).includes(id));
      return {
        ...current,
        layerIds,
        areas: current.areas.map((area) => ({ ...area, layerIds })),
      };
    });
    this.adoptCatalog(catalog);
    // Catalog intent is committed. Releasing disabled-layer pins must not hold
    // the controls or delay an unrelated provider's download.
    const { activateDownloadCoverage } =
      await import('./tileCache/DownloadAreaRepository');
    const key = this.coverage.key;
    const maintenance = activateDownloadCoverage(key)
      .then(() => this.cleanupReleased())
      .then(() => this.readCoverage())
      .catch((error) => {
        if (!isAbortError(error))
          this.publish({
            error:
              'Layer settings were saved. Download storage will be checked again on restart.',
          });
      })
      .finally(() => this.maintenance.delete(maintenance));
    this.maintenance.add(maintenance);
    if (restored) this.queueLayers(added, false);
    else this.resume();
  }
  private updatedArea(
    previous: DownloadArea | undefined,
    input: DownloadAreaInput,
    id: string = crypto.randomUUID(),
  ): DownloadArea {
    const changed =
      !previous ||
      JSON.stringify([previous.topLeft, previous.bottomRight]) !==
        JSON.stringify([input.topLeft, input.bottomRight]);
    return {
      ...input,
      areaId: previous?.areaId ?? id,
      revision: (previous?.revision ?? 0) + (changed ? 1 : 0),
    };
  }
  retry(_areaId: string, forceRefresh = false): void {
    this.resume(forceRefresh);
  }
  resumeManual(): void {
    this.resume();
  }
  resume(forceRefresh = false): void {
    this.queueLayers(this.layerIds, forceRefresh);
  }
  private queueLayers(
    layerIds: readonly string[],
    forceRefresh: boolean,
  ): void {
    if (this.disposed) return;
    if (this.foreground) this.engine.resumeBlocked();
    if (!this.coverage.projects.length) return;
    for (const id of layerIds) {
      const existing = this.layers.get(id);
      if (
        !forceRefresh &&
        this.current?.layerId === id &&
        !this.current.abort.signal.aborted
      )
        continue;
      if (
        !forceRefresh &&
        existing?.key === this.coverage.key &&
        existing.status === 'downloaded' &&
        existing.refreshAfter > Date.now()
      )
        continue;
      this.queue.set(id, forceRefresh || this.queue.get(id) === true);
    }
    this.startDrain();
  }
  private startDrain(): void {
    if (
      this.draining ||
      !this.queue.size ||
      !this.online() ||
      !this.foreground ||
      this.disposed
    )
      return;
    this.draining = this.drain()
      .catch(() => {
        this.publish({ error: 'Offline map preparation failed. Try again.' });
      })
      .finally(() => {
        this.draining = null;
        this.startDrain();
      });
  }
  private coveragePlan(): Promise<OfflineMapPlanningInput> {
    if (!this.plan) {
      const coverage = this.coverage;
      this.plan = import('./OfflineMapPlanner').then(
        async ({ computeOfflineMapSourceRevision }) => ({
          sourceRevision: await computeOfflineMapSourceRevision([coverage.key]),
          projects: coverage.projects,
          points: [],
          paths: [],
          padMeters: 0,
          minZoom: AREA_MIN_ZOOM,
          maxZoom: AREA_MAX_ZOOM,
        }),
      );
    }
    return this.plan;
  }
  private async drain(): Promise<void> {
    while (
      this.queue.size &&
      this.online() &&
      this.foreground &&
      !this.disposed
    ) {
      const [layerId, forceRefresh] = this.queue.entries().next().value!;
      this.queue.delete(layerId);
      if (
        !this.coverage.projects.length ||
        !this.layerIds.some((id) => id === layerId)
      )
        continue;
      const job = {
        layerId,
        key: this.coverage.key,
        abort: new AbortController(),
      };
      this.current = job;
      const prior = this.layers.get(layerId);
      this.layers.set(layerId, {
        key: job.key,
        status: 'planning',
        refreshAfter: 0,
        progress:
          prior?.key === job.key
            ? prior.progress
            : this.emptyProgress(layerId, this.coordinateCount ?? 0),
      });
      this.publishProgress();
      try {
        const plan = await this.coveragePlan();
        if (job.abort.signal.aborted || this.disposed) continue;
        const layer = MAP_LAYERS.find((value) => value.id === layerId)!;
        const result = await this.engine.schedule({
          mode: 'rebuild',
          coverageKey: job.key,
          plan,
          layers: [{ id: layer.id, tileUrlTemplate: layer.tileUrlTemplate }],
          forceRefresh,
          signal: job.abort.signal,
        });
        if (!job.abort.signal.aborted) {
          this.coordinateCount = result.coordinateCount;
          this.publishProgress();
        }
        await this.engine.waitForIdle();
        if (!job.abort.signal.aborted && !this.disposed) {
          this.receiveProgress();
          const state = this.layers.get(layerId)!;
          state.status =
            this.engine.getSnapshot().phase === 'completed'
              ? 'downloaded'
              : 'incomplete';
          if (state.status === 'downloaded') this.markAreasReady(layerId);
          // Durable refresh deadlines are authoritative; unchanged layers need no new session.
          const { getOfflineMapGenerations } =
            await import('./tileCache/TileCacheRepository');
          const active = (await getOfflineMapGenerations()).find(
            (g) =>
              g.layerId === layerId &&
              g.coverageKey === job.key &&
              (g.status === 'active' || g.status === 'pending'),
          );
          state.refreshAfter = active?.refreshAfter ?? 0;
          await this.readCoverage();
        }
      } catch (error) {
        if (!isAbortError(error) && !job.abort.signal.aborted) {
          const state = this.layers.get(layerId);
          if (state?.key === job.key) state.status = 'incomplete';
        }
      } finally {
        this.current = null;
        this.publishProgress();
      }
    }
    await this.cleanupReleased();
    await this.retireLegacyCoverage();
  }
  private emptyProgress(
    layerId: string,
    totalTiles: number,
  ): OfflineMapLayerProgress {
    return {
      layerId,
      totalTiles,
      completedTiles: 0,
      failedTiles: 0,
      cachedFreshTiles: 0,
      auditedTiles: 0,
      queuedTiles: 0,
      downloadedTiles: 0,
      bytesDownloaded: 0,
      usableTiles: 0,
    };
  }
  private markAreasReady(layerId: string): void {
    for (const ready of this.readyAreas.values()) ready.layers.add(layerId);
  }
  private receiveProgress(): void {
    if (this.disposed) return;
    const state = this.engine.getSnapshot();
    const job = this.current;
    if (job && !job.abort.signal.aborted && state.coverageKey === job.key) {
      const progress = state.layers.find(
        (layer) => layer.layerId === job.layerId,
      );
      if (state.coordinateCount !== null)
        this.coordinateCount = state.coordinateCount;
      if (progress) {
        const previous = this.layers.get(job.layerId);
        this.layers.set(job.layerId, {
          key: job.key,
          refreshAfter: previous?.refreshAfter ?? 0,
          status:
            state.phase === 'completed'
              ? 'downloaded'
              : state.phase === 'completed-with-errors'
                ? 'incomplete'
                : state.phase === 'storage-blocked'
                  ? 'storage-blocked'
                  : state.phase === 'paused'
                    ? 'waiting'
                    : state.phase === 'planning'
                      ? 'planning'
                      : 'downloading',
          progress,
        });
      }
    }
    this.publishProgress();
  }
  private publishProgress(): void {
    if (this.disposed) return;
    const raw = this.engine.getSnapshot();
    // Before catalog restore, preserve engine recovery/consent diagnostics.
    if (!this.snapshot.areas.length && !this.coverage.projects.length) {
      this.syncStore.publish(
        {
          ...EMPTY_OFFLINE_MAP_SYNC_SNAPSHOT,
          cacheBytes: raw.cacheBytes,
          blockedByStorage: raw.blockedByStorage,
        },
        true,
      );
      this.publish({
        progress: Object.fromEntries(
          this.snapshot.areas.map((area) => [
            area.areaId,
            {
              revision: area.revision,
              status: 'too-large',
              completedTiles: 0,
              totalTiles: 0,
            },
          ]),
        ),
      });
      return;
    }
    const layers = this.layerIds.map((id) => {
      const state = this.layers.get(id);
      const total = this.coordinateCount ?? 0;
      return state?.key === this.coverage.key
        ? {
            ...state.progress,
            totalTiles: total,
            completedTiles: Math.min(total, state.progress.completedTiles),
          }
        : this.emptyProgress(id, total);
    });
    const statuses = this.layerIds.map((id) =>
      this.layers.get(id)?.key === this.coverage.key
        ? this.layers.get(id)!.status
        : 'queued',
    );
    const status: DownloadAreaProgress['status'] = !this.online()
      ? 'waiting'
      : statuses.every((value) => value === 'downloaded')
        ? 'downloaded'
        : statuses.includes('storage-blocked')
          ? 'storage-blocked'
          : this.current
            ? this.coordinateCount === null
              ? 'planning'
              : 'downloading'
            : statuses.includes('incomplete')
              ? 'incomplete'
              : 'queued';
    const totalTiles = layers.reduce((n, layer) => n + layer.totalTiles, 0);
    const completedTiles = layers.reduce(
      (n, layer) => n + layer.completedTiles,
      0,
    );
    const phase =
      status === 'downloaded'
        ? 'completed'
        : status === 'incomplete'
          ? 'completed-with-errors'
          : status === 'waiting'
            ? 'paused'
            : status === 'queued'
              ? 'idle'
              : status;
    this.syncStore.publish(
      {
        ...raw,
        areaId: undefined,
        coverageKey: this.coverage.key,
        phase,
        coordinateCount: this.coordinateCount,
        enabledLayerCount: layers.length,
        layers,
        totalTiles,
        completedTiles,
        coverageTotalTiles: totalTiles,
        coverageCompletedTiles: completedTiles,
        failedTiles: layers.reduce((n, layer) => n + layer.failedTiles, 0),
        blockedByStorage: status === 'storage-blocked',
      },
      true,
    );
    this.publish({
      progress: Object.fromEntries(
        this.snapshot.areas.map((area) => {
          const count = this.counts.get(area.areaId) ?? 0;
          const ready = this.layerIds.every((id) =>
            this.readyAreas.get(area.areaId)?.layers.has(id),
          );
          return [
            area.areaId,
            {
              revision: area.revision,
              status:
                count > MAX_AREA_COORDINATES
                  ? 'too-large'
                  : ready
                    ? 'downloaded'
                    : status,
              // Progress describes the shared batch; a rectangle is ready only after every enabled layer is complete.
              completedTiles: ready ? count * layers.length : completedTiles,
              totalTiles: ready ? count * layers.length : totalTiles,
            },
          ];
        }),
      ),
    });
  }
  private async retireLegacyCoverage(): Promise<void> {
    if (
      !this.sourceReconciled ||
      this.disposed ||
      this.snapshot.areas.some(
        (area) => this.snapshot.progress[area.areaId]?.status !== 'downloaded',
      )
    )
      return;
    const { getOfflineMapGenerations, releaseOfflineMapGeneration } =
      await import('./tileCache/TileCacheRepository');
    for (const generation of await getOfflineMapGenerations()) {
      if (this.disposed) return;
      if (!generation.coverageKey)
        await releaseOfflineMapGeneration(generation.id);
    }
  }
  private async cleanupReleased(): Promise<void> {
    if (this.disposed) return;
    const { getOfflineMapGenerations, releaseOfflineMapGeneration } =
      await import('./tileCache/TileCacheRepository');
    for (const generation of await getOfflineMapGenerations())
      if (!this.disposed && generation.status === 'releasing')
        await releaseOfflineMapGeneration(generation.id);
  }
  reportAutomaticError(): void {
    this.publish({
      error:
        'Some map sources could not be updated. Previous downloads are preserved.',
    });
  }
  private assertActive(): void {
    if (this.disposed) throw new DOMException('Session ended', 'AbortError');
  }
  setForeground(active: boolean): void {
    this.foreground = active;
    if (!active && this.current) {
      this.queue.set(this.current.layerId, false);
      this.current.abort.abort();
    }
    if (active) this.resume();
  }
  cancel(): void {
    this.queue.clear();
    this.current?.abort.abort();
  }
  async waitForIdle(): Promise<void> {
    await this.loaded?.catch(() => {});
    while (this.draining) await this.draining;
    while (this.maintenance.size) await Promise.all(this.maintenance);
  }
  dispose(): void {
    this.disposed = true;
    this.cancel();
    this.unsubscribe();
    this.listeners.clear();
    this.syncStore.dispose();
  }
}
