import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import type { SpeleoDBController } from '../controllers/SpeleoDBController';
import type { SyncStatus } from '../controllers/SpeleoDBController';
import type { AuthState } from '../types';
import type { Project } from '../types/project';
import type { OfflineMapSyncSnapshot } from '../types/offlineMapSync';
import type { ProjectGeoJSONWarning } from '../types/projectGeoJSON';
import type { GpsRecordingState, GpsTrackListItem } from '../types/gpsTrack';

export interface SpeleoDBContextValue {
  controller: SpeleoDBController;
  authState: AuthState;
  isOnline: boolean;
  isOfflineLocked: boolean;
  projects: Project[];
  syncStatus: SyncStatus;
  lastSyncedAt: number | null;
  projectGeoJSONWarnings: ProjectGeoJSONWarning[];
  /** Bumped after a map-data synchronization attempt reaches a terminal state. */
  mapDataRevision: number;
  /** Bumped after any landmark create/edit/delete writes the cached overlay. */
  landmarksRevision: number;
  /** Number of pending offline mutations (drives the Pending tab + badge). */
  pendingOpsCount: number;
  /** Bumped on any offline-queue change so the Pending page re-reads the list. */
  pendingOpsRevision: number;
  /** Storage-consent modal should be open (one-time auto prompt or manual re-trigger). */
  storageConsentRequired: boolean;
  /** Prefetch stalled at the cache cap and overflow not yet approved. */
  isTileCacheOverLimit: boolean;
  /** User approved letting prefetch exceed the cache cap. */
  isTileCacheOverLimitApproved: boolean;
  /** Unified GPS track list (local recordings + server tracks, newest first). */
  gpsTracks: GpsTrackListItem[];
  /** Live GPS recording lifecycle. */
  gpsRecordingState: GpsRecordingState;
  /** Epoch ms the current recording started (null when idle). */
  gpsRecordingStartedAt: number | null;
  /** Active recording duration, excluding paused wall time, at the last snapshot. */
  gpsRecordingElapsedMs: number;
  /** Epoch ms for the elapsed snapshot; non-null only while actively recording. */
  gpsRecordingElapsedUpdatedAt: number | null;
  /** Bumped on any GPS track/recording change. */
  gpsTracksRevision: number;
  /** One-shot message when a recording was stopped by a fatal location error. */
  gpsRecordingError: string | null;
}

export const SpeleoDBContext = createContext<SpeleoDBContextValue | null>(null);

export function useSpeleoDB(): SpeleoDBContextValue {
  const ctx = useContext(SpeleoDBContext);
  if (!ctx) {
    throw new Error('useSpeleoDB must be used within SpeleoDBProvider');
  }
  return ctx;
}

/**
 * High-frequency offline-map progress intentionally bypasses the app-wide
 * context value so a tile commit rerenders only consumers that display it.
 */
export function useOfflineMapSync(): OfflineMapSyncSnapshot {
  const { controller } = useSpeleoDB();
  const subscribe = useCallback(
    (listener: () => void) => controller.subscribeOfflineMapSync(listener),
    [controller],
  );
  const getSnapshot = useCallback(
    () => controller.offlineMapSyncSnapshot,
    [controller],
  );
  return useSyncExternalStore(subscribe, getSnapshot);
}
