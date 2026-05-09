import { useState, useSyncExternalStore, type ReactNode } from 'react'

import { HttpClient } from '../services/HttpClient'
import { SpeleoDBService } from '../services/SpeleoDBService'
import { ProjectCacheService } from '../services/ProjectCacheService'
import {
  getPreferences,
  setPreferences,
  clearPreferences,
} from '../services/PreferencesService'
import { SpeleoDBController } from '../controllers/SpeleoDBController'
import { SpeleoDBContext } from './useSpeleoDB'
import type { SpeleoDBContextValue } from './useSpeleoDB'

interface SpeleoDBStoreProviderProps {
  children: ReactNode
}

export function SpeleoDBStoreProvider({ children }: SpeleoDBStoreProviderProps) {
  const [controller] = useState(() => {
    const http = new HttpClient()
    const service = new SpeleoDBService(http)
    const projectCache = new ProjectCacheService()
    return new SpeleoDBController(
      service,
      { getPreferences, setPreferences, clearPreferences },
      projectCache,
    )
  })

  const authState = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.authState,
  )

  const isOnline = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.isOnline,
  )

  const projects = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.projects,
  )

  const isOfflineLocked = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.isOfflineLocked,
  )

  const syncStatus = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.syncStatus,
  )

  const lastSyncedAt = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.lastSyncedAt,
  )

  const tilePrefetchJobs = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.tilePrefetchJobs,
  )

  const value: SpeleoDBContextValue = {
    controller,
    authState,
    isOnline,
    isOfflineLocked,
    projects,
    syncStatus,
    lastSyncedAt,
    tilePrefetchJobs,
  }

  return (
    <SpeleoDBContext.Provider value={value}>
      {children}
    </SpeleoDBContext.Provider>
  )
}
