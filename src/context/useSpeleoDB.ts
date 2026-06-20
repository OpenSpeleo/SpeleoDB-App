import { createContext, useContext } from 'react';
import type { SpeleoDBController } from '../controllers/SpeleoDBController';
import type { SyncStatus } from '../controllers/SpeleoDBController';
import type { AuthState } from '../types';
import type { Project } from '../types/project';
import type { TilePrefetchJobState } from '../types/tilePrefetch';

export interface SpeleoDBContextValue {
  controller: SpeleoDBController;
  authState: AuthState;
  isOnline: boolean;
  isOfflineLocked: boolean;
  projects: Project[];
  syncStatus: SyncStatus;
  lastSyncedAt: number | null;
  tilePrefetchJobs: TilePrefetchJobState[];
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
}

export const SpeleoDBContext = createContext<SpeleoDBContextValue | null>(null);

export function useSpeleoDB(): SpeleoDBContextValue {
  const ctx = useContext(SpeleoDBContext);
  if (!ctx) {
    throw new Error('useSpeleoDB must be used within SpeleoDBProvider');
  }
  return ctx;
}
