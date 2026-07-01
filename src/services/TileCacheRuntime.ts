type TileCacheServiceModule = typeof import('./TileCacheService')

let tileCacheServicePromise: Promise<TileCacheServiceModule> | null = null
let pendingOfflineMode = false
let pendingOverLimitApproved = false

async function loadTileCacheService(): Promise<TileCacheServiceModule> {
  if (!tileCacheServicePromise) {
    tileCacheServicePromise = import('./TileCacheService')
      .then((module) => {
        module.setTileCacheOfflineMode(pendingOfflineMode)
        module.setTileCacheOverLimitApproved(pendingOverLimitApproved)
        return module
      })
      .catch((error) => {
        tileCacheServicePromise = null
        throw error
      })
  }

  return tileCacheServicePromise
}

export function setTileCacheOfflineModeRuntime(isOffline: boolean): void {
  pendingOfflineMode = isOffline

  if (!tileCacheServicePromise && !isOffline) {
    return
  }

  void loadTileCacheService()
    .then((module) => {
      module.setTileCacheOfflineMode(isOffline)
    })
    .catch(() => {
      // The runtime will retry on the next tile-cache operation.
    })
}

export function setTileCacheOverLimitApprovedRuntime(approved: boolean): void {
  pendingOverLimitApproved = approved

  if (!tileCacheServicePromise && !approved) {
    return
  }

  void loadTileCacheService()
    .then((module) => {
      module.setTileCacheOverLimitApproved(approved)
    })
    .catch(() => {
      // The runtime will retry on the next tile-cache operation.
    })
}

export async function clearCachedTilesRuntime(): Promise<void> {
  const module = await loadTileCacheService()
  await module.clearCachedTiles()
}

export async function evictLayerTilesRuntime(prefixes: string[]): Promise<void> {
  const module = await loadTileCacheService()
  await module.evictLayerTiles(prefixes)
}
