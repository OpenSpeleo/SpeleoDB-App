import type {
  TilePrefetchEnqueueOptions,
  TilePrefetchJobState,
  TilePrefetchProjectInput,
  TilePrefetchRemoveOptions,
  TilePrefetchRequest,
  TilePrefetchTileUrlsInput,
} from '../types/tilePrefetch'
import type { TilePrefetchServiceLike } from './TilePrefetchService'

interface LazyTilePrefetchOptions {
  isOnline?: () => boolean
}

type JobsListener = (jobs: TilePrefetchJobState[]) => void

const NOOP_TILE_PREFETCH_SERVICE: TilePrefetchServiceLike = {
  subscribe: () => () => {},
  enqueueProjects: async () => {},
  enqueueTileUrls: async () => {},
  removeLayer: async () => {},
  removeTarget: async () => {},
  resumeBlockedJobs: () => {},
  waitForIdle: async () => {},
  dispose: () => {},
}

/**
 * Defers the TilePrefetchService import until runtime work actually needs it.
 * This keeps the map tile/cache stack out of the initial JS graph.
 */
export class LazyTilePrefetchService implements TilePrefetchServiceLike {
  private listeners = new Set<JobsListener>()
  private jobs: TilePrefetchJobState[] = []
  private service: TilePrefetchServiceLike | null = null
  private servicePromise: Promise<TilePrefetchServiceLike> | null = null
  private serviceUnsubscribe: (() => void) | null = null
  private disposed = false

  constructor(private options: LazyTilePrefetchOptions = {}) {}

  subscribe(listener: JobsListener): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => {
      this.listeners.delete(listener)
    }
  }

  async preload(): Promise<void> {
    await this.loadService()
  }

  async enqueueProjects(
    projects: TilePrefetchProjectInput[],
    request: TilePrefetchRequest,
    options: TilePrefetchEnqueueOptions = {},
  ): Promise<void> {
    if (this.disposed || projects.length === 0) return
    const service = await this.loadService()
    if (this.disposed) return
    await service.enqueueProjects(projects, request, options)
  }

  async enqueueTileUrls(
    target: TilePrefetchTileUrlsInput,
    options: TilePrefetchEnqueueOptions = {},
  ): Promise<void> {
    if (this.disposed || target.tileUrls.length === 0) return
    const service = await this.loadService()
    if (this.disposed) return
    await service.enqueueTileUrls(target, options)
  }

  async removeLayer(layerId: string): Promise<void> {
    if (this.disposed) return
    // Only meaningful once the underlying service exists; if it has never been
    // loaded there are no in-memory jobs, but persisted jobs may still exist.
    const service = await this.loadService()
    if (this.disposed) return
    await service.removeLayer(layerId)
  }

  async removeTarget(
    targetId: string,
    options: TilePrefetchRemoveOptions = {},
  ): Promise<void> {
    if (this.disposed) return
    const service = await this.loadService()
    if (this.disposed) return
    await service.removeTarget(targetId, options)
  }

  resumeBlockedJobs(): void {
    // Only meaningful once the underlying service (and its in-memory queue)
    // exists; nothing to resume otherwise.
    this.service?.resumeBlockedJobs()
  }

  async waitForIdle(): Promise<void> {
    if (!this.servicePromise) return
    const service = await this.servicePromise
    await service.waitForIdle()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    const pendingService = this.servicePromise
    this.serviceUnsubscribe?.()
    this.serviceUnsubscribe = null
    this.service = null
    this.servicePromise = null
    this.jobs = []
    this.notify()
    this.listeners.clear()

    if (pendingService) {
      void pendingService.then((service) => {
        service.dispose()
      }).catch(() => {
        // Ignore load failures during teardown.
      })
    }
  }

  private snapshot(): TilePrefetchJobState[] {
    return [...this.jobs]
  }

  private notify(): void {
    const snapshot = this.snapshot()
    this.listeners.forEach((listener) => listener(snapshot))
  }

  private async loadService(): Promise<TilePrefetchServiceLike> {
    if (this.disposed) {
      return NOOP_TILE_PREFETCH_SERVICE
    }

    if (!this.servicePromise) {
      this.servicePromise = import('./TilePrefetchService')
        .then((module) => {
          const service = new module.TilePrefetchService({
            isOnline: this.options.isOnline ?? (() => true),
          })

          if (this.disposed) {
            service.dispose()
            return NOOP_TILE_PREFETCH_SERVICE
          }

          this.service = service
          this.serviceUnsubscribe = service.subscribe((jobs) => {
            this.jobs = [...jobs]
            this.notify()
          })
          return service
        })
        .catch((error) => {
          this.servicePromise = null
          throw error
        })
    }

    return this.servicePromise
  }
}
