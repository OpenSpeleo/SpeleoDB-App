import { useState, useSyncExternalStore, type ReactNode } from 'react'

import { HttpClient } from '../services/HttpClient'
import { SpeleoDBService } from '../services/SpeleoDBService'
import { ProjectCacheService } from '../services/ProjectCacheService'
import { appSessionStore } from '../services/AppSessionStore'
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
      {
        getPreferences,
        setPreferences,
        clearPreferences,
        session: appSessionStore,
      },
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

  const projectGeoJSONWarnings = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.projectGeoJSONWarnings,
  )

  const mapDataRevision = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.mapDataRevision,
  )

  const landmarksRevision = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.landmarksRevision,
  )

  const pendingOpsCount = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.pendingOpsCount,
  )

  const pendingOpsRevision = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.pendingOpsRevision,
  )

  const storageConsentRequired = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.storageConsentRequired,
  )

  const isTileCacheOverLimit = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.isTileCacheOverLimit,
  )

  const isTileCacheOverLimitApproved = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.isTileCacheOverLimitApproved,
  )

  const gpsTracks = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.gpsTracks,
  )

  const gpsRecordingState = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.gpsRecordingState,
  )

  const gpsRecordingStartedAt = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.gpsRecordingStartedAt,
  )

  const gpsRecordingElapsedMs = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.gpsRecordingElapsedMs,
  )

  const gpsRecordingElapsedUpdatedAt = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.gpsRecordingElapsedUpdatedAt,
  )

  const gpsTracksRevision = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.gpsTracksRevision,
  )

  const gpsRecordingError = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.gpsRecordingError,
  )

  const value: SpeleoDBContextValue = {
    controller,
    authState,
    isOnline,
    isOfflineLocked,
    projects,
    syncStatus,
    lastSyncedAt,
    projectGeoJSONWarnings,
    mapDataRevision,
    landmarksRevision,
    pendingOpsCount,
    pendingOpsRevision,
    storageConsentRequired,
    isTileCacheOverLimit,
    isTileCacheOverLimitApproved,
    gpsTracks,
    gpsRecordingState,
    gpsRecordingStartedAt,
    gpsRecordingElapsedMs,
    gpsRecordingElapsedUpdatedAt,
    gpsTracksRevision,
    gpsRecordingError,
  }

  return (
    <SpeleoDBContext.Provider value={value}>
      {children}
    </SpeleoDBContext.Provider>
  )
}
