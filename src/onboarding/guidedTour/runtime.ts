type GuidedTourEngine = typeof import('./engine')

let enginePromise: Promise<GuidedTourEngine> | null = null
let loadedEngine: GuidedTourEngine | null = null
let tourRequestGeneration = 0

async function loadGuidedTourEngine(): Promise<GuidedTourEngine> {
  if (loadedEngine) {
    return loadedEngine
  }

  if (!enginePromise) {
    enginePromise = import('./engine').then((engine) => {
      loadedEngine = engine
      return engine
    })
  }

  return enginePromise
}

export function destroyGuidedTour(): void {
  tourRequestGeneration += 1
  loadedEngine?.destroyGuidedTour()
}

export async function restartGuidedTourFromHelp(): Promise<void> {
  const generation = ++tourRequestGeneration
  const engine = await loadGuidedTourEngine()
  if (generation !== tourRequestGeneration) return
  await engine.restartGuidedTourFromHelp()
}

export async function startGuidedTour(
  options?: Parameters<GuidedTourEngine['startGuidedTour']>[0],
): Promise<void> {
  const generation = ++tourRequestGeneration
  const engine = await loadGuidedTourEngine()
  if (generation !== tourRequestGeneration) return
  await engine.startGuidedTour(options)
}
