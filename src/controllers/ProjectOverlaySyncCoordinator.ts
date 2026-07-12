import { MAP_OVERLAYS } from '../constants';
import type { ProjectCacheService } from '../services/ProjectCacheService';
import type { SpeleoDBService } from '../services/SpeleoDBService';
import type { MapOverlayId } from '../types/mapOverlay';
import type { OverlaySyncPhaseResult } from '../types/sync';
import { isAbortError } from '../utils/abort';
import { mapLandmarkCollections } from '../utils/landmarkMutations';
import { normalizeGeoJSON } from '../utils/normalizeGeoJSON';
import { CancellationContext } from './CancellationContext';

interface PendingMutationView {
  readonly isReplaying: boolean;
  readonly count: number;
  load(): Promise<void>;
}

interface ProjectOverlaySyncDependencies {
  cache: ProjectCacheService;
  transport: SpeleoDBService;
  pendingMutations(): PendingMutationView;
  hasNetworkAccess(): boolean;
}

function isSuccessfulStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

export function createSkippedOverlaySyncPhase(
  reason: OverlaySyncPhaseResult['reason'],
): OverlaySyncPhaseResult {
  return {
    phase: 'overlay_sync',
    status: reason === 'aborted' ? 'aborted' : 'skipped',
    reason,
    attemptedOverlayCount: 0,
    syncedOverlayCount: 0,
    failedOverlayCount: 0,
  };
}

/** Synchronizes shared map overlays without owning UI or project-list state. */
export class ProjectOverlaySyncCoordinator {
  constructor(private readonly dependencies: ProjectOverlaySyncDependencies) {}

  async sync(
    context: CancellationContext,
    instance: string,
    token: string,
  ): Promise<OverlaySyncPhaseResult> {
    if (!this.dependencies.hasNetworkAccess()) {
      return createSkippedOverlaySyncPhase('offline_locked');
    }

    const [outcomes] = await Promise.all([
      Promise.all(MAP_OVERLAYS.map(async (overlay) => {
        context.throwIfAborted();
        if (!this.dependencies.hasNetworkAccess()) return 'skipped' as const;
        if (overlay.id === 'landmarks' && await this.shouldSkipLandmarks()) {
          return 'skipped' as const;
        }
        return this.syncOverlay(context, overlay.id, instance, token);
      })),
      this.cacheLandmarkCollections(context, instance, token),
    ]);

    const syncedOverlayCount = outcomes.filter((outcome) => outcome === 'synced').length;
    const failedOverlayCount = outcomes.filter((outcome) => outcome === 'failed').length;
    return {
      phase: 'overlay_sync',
      status: failedOverlayCount > 0 ? 'failed' : 'applied',
      reason: failedOverlayCount > 0 ? 'overlay_sync_partial_failure' : 'overlays_synced',
      attemptedOverlayCount: MAP_OVERLAYS.length,
      syncedOverlayCount,
      failedOverlayCount,
    };
  }

  private async syncOverlay(
    context: CancellationContext,
    overlayId: MapOverlayId,
    instance: string,
    token: string,
  ): Promise<'synced' | 'failed'> {
    try {
      const response = await this.fetchOverlay(overlayId, instance, token, context);
      context.throwIfAborted();
      if (!isSuccessfulStatus(response.status)) {
        console.warn(`Overlay sync skipped for ${overlayId}: status ${response.status}`);
        return 'failed';
      }
      const normalized = normalizeGeoJSON(response.data);
      if (!normalized) {
        console.warn(`Overlay sync skipped for ${overlayId}: malformed 2xx payload`);
        return 'failed';
      }
      const cached = await this.dependencies.cache.setOverlayGeoJSON(
        overlayId,
        normalized,
        { signal: context.signal },
      );
      context.throwIfAborted();
      return cached ? 'synced' : 'failed';
    } catch (error) {
      if (isAbortError(error)) throw error;
      console.warn(`Failed to sync overlay ${overlayId}:`, error);
      return 'failed';
    }
  }

  private async shouldSkipLandmarks(): Promise<boolean> {
    const pendingMutations = this.dependencies.pendingMutations();
    if (pendingMutations.isReplaying) return true;
    try {
      await pendingMutations.load();
    } catch (error) {
      console.warn('Skipping landmarks overlay sync because pending ops could not be loaded:', error);
      return true;
    }
    return pendingMutations.count > 0;
  }

  private async cacheLandmarkCollections(
    context: CancellationContext,
    instance: string,
    token: string,
  ): Promise<void> {
    try {
      context.throwIfAborted();
      const response = await this.dependencies.transport.getLandmarkCollections(
        instance,
        token,
        { signal: context.signal },
      );
      context.throwIfAborted();
      if (isSuccessfulStatus(response.status)) {
        await this.dependencies.cache.setLandmarkCollections(
          mapLandmarkCollections(response.data),
          { signal: context.signal },
        );
        context.throwIfAborted();
      }
    } catch (error) {
      if (isAbortError(error)) throw error;
      console.warn('Failed to cache landmark collections during sync:', error);
    }
  }

  private fetchOverlay(
    overlayId: MapOverlayId,
    instance: string,
    token: string,
    context: CancellationContext,
  ): ReturnType<SpeleoDBService['getLandmarksGeoJSON']> {
    const options = { signal: context.signal };
    switch (overlayId) {
      case 'landmarks':
        return this.dependencies.transport.getLandmarksGeoJSON(instance, token, options);
      case 'subsurfaceStations':
        return this.dependencies.transport.getSubsurfaceStationsGeoJSON(instance, token, options);
      case 'surfaceStations':
        return this.dependencies.transport.getSurfaceStationsGeoJSON(instance, token, options);
      case 'explorationLeads':
        return this.dependencies.transport.getExplorationLeadsGeoJSON(instance, token, options);
      case 'cylinderInstalls':
        return this.dependencies.transport.getCylinderInstallsGeoJSON(instance, token, options);
      default: {
        const exhaustiveCheck: never = overlayId;
        throw new Error(`Unsupported overlay id: ${exhaustiveCheck}`);
      }
    }
  }
}
