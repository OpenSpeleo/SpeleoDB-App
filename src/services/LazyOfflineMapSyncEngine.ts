import type {
  OfflineMapSyncRequest,
  OfflineMapSyncResult,
  OfflineMapSyncSnapshot,
} from '../types/offlineMapSync';
import type { OfflineMapSyncEngineLike } from './OfflineMapSyncEngine';
import { OfflineMapSyncStore } from './OfflineMapSyncStore';

interface LazyOfflineMapSyncEngineOptions {
  isOnline(): boolean;
}

/** Keeps planner, repository mutation code, and worker bootstrap off initial JS. */
export class LazyOfflineMapSyncEngine implements OfflineMapSyncEngineLike {
  private readonly store = new OfflineMapSyncStore();
  private engine: OfflineMapSyncEngineLike | null = null;
  private loading: Promise<OfflineMapSyncEngineLike> | null = null;
  private disposed = false;

  constructor(private readonly options: LazyOfflineMapSyncEngineOptions) {}

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener);
  }

  getSnapshot(): OfflineMapSyncSnapshot {
    return this.store.getSnapshot();
  }

  async preload(): Promise<void> {
    const engine = await this.load();
    await engine.preload();
  }

  async schedule(request: OfflineMapSyncRequest): Promise<OfflineMapSyncResult> {
    return (await this.load()).schedule(request);
  }

  async waitForIdle(): Promise<void> {
    if (this.loading) await (await this.loading).waitForIdle();
    else await this.engine?.waitForIdle();
  }

  resumeBlocked(): void {
    this.engine?.resumeBlocked();
  }

  async releaseLayer(layerId: string): Promise<void> {
    await (await this.load()).releaseLayer(layerId);
  }

  async refreshCacheStats(): Promise<void> {
    await (await this.load()).refreshCacheStats?.();
  }

  cancel(): void {
    this.engine?.cancel();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.engine?.dispose();
    this.store.reset();
    if (this.loading) {
      void this.loading.then((engine) => engine.dispose()).catch(() => {});
    }
  }

  private async load(): Promise<OfflineMapSyncEngineLike> {
    if (this.disposed) throw new Error('Offline-map synchronization is disposed');
    if (this.engine) return this.engine;
    if (!this.loading) {
      this.loading = import('./OfflineMapSyncEngine')
        .then(({ OfflineMapSyncEngine }) => {
          if (this.disposed) throw new Error('Offline-map synchronization is disposed');
          const engine = new OfflineMapSyncEngine({
            store: this.store,
            isOnline: this.options.isOnline,
          });
          this.engine = engine;
          return engine;
        })
        .catch((error) => {
          this.loading = null;
          throw error;
        });
    }
    return this.loading;
  }
}
