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
  isRetryingConnection: boolean;
  projects: Project[];
  syncStatus: SyncStatus;
  tilePrefetchJobs: TilePrefetchJobState[];
}

export const SpeleoDBContext = createContext<SpeleoDBContextValue | null>(null);

export function useSpeleoDB(): SpeleoDBContextValue {
  const ctx = useContext(SpeleoDBContext);
  if (!ctx) {
    throw new Error('useSpeleoDB must be used within SpeleoDBProvider');
  }
  return ctx;
}
