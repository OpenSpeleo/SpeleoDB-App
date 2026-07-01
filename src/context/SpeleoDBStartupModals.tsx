import { useEffect, useState, type ReactNode } from 'react'
import { IonButton, IonContent, IonModal } from '@ionic/react'

import logoPng from '../assets/media/logo.png'
import { MAP } from '../constants'
import type { StartupUiCoordinatorResult } from './useStartupUiCoordinator'
import { useSpeleoDB } from './useSpeleoDB'

interface SpeleoDBStartupModalsProps {
  startupUi: StartupUiCoordinatorResult
}

const TILE_CACHE_CAP_MB = Math.round(MAP.TILE_CACHE_MAX_BYTES / (1024 * 1024))

export function SpeleoDBStartupModals({
  startupUi,
}: SpeleoDBStartupModalsProps): ReactNode {
  const { authState, controller, projectGeoJSONWarnings = [] } = useSpeleoDB()
  const [isAcknowledgingProjectWarnings, setIsAcknowledgingProjectWarnings] = useState(false)
  const [projectWarningError, setProjectWarningError] = useState<string | null>(null)
  const warningCount = projectGeoJSONWarnings.length

  const warningReason = (warning: (typeof projectGeoJSONWarnings)[number]): string => {
    if (
      warning.reason === 'bbox_too_large'
      && warning.widthKm !== null
      && warning.heightKm !== null
    ) {
      return `Bounding box ${warning.widthKm.toFixed(1)} km × ${warning.heightKm.toFixed(1)} km exceeds the 100 km × 100 km limit.`
    }
    if (warning.reason === 'bbox_timeout') {
      return 'A previous validation timed out. The project will be retried when online.'
    }
    if (warning.reason === 'validation_unavailable') {
      return 'The GeoJSON could not be safely validated and is disabled for this session.'
    }
    if (warning.reason === 'invalid_geojson') {
      return 'The file is not a valid GeoJSON FeatureCollection.'
    }
    if (warning.reason === 'no_coordinates') {
      return 'The GeoJSON does not contain usable geographic coordinates.'
    }
    if (warning.reason === 'bbox_too_large') {
      return 'The GeoJSON exceeds the safe 100 km × 100 km map extent.'
    }
    return 'The GeoJSON bounding box could not be measured safely.'
  }

  useEffect(() => {
    if (!authState.isAuthenticated) return
    void controller.preloadOfflineMaps()
  }, [authState.isAuthenticated, controller])

  useEffect(() => {
    if (startupUi.showProjectGeoJSONWarningModal) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setIsAcknowledgingProjectWarnings(false)
      setProjectWarningError(null)
    })
    return () => { cancelled = true }
  }, [startupUi.showProjectGeoJSONWarningModal])

  const acknowledgeProjectWarnings = async (): Promise<void> => {
    if (isAcknowledgingProjectWarnings) return
    setIsAcknowledgingProjectWarnings(true)
    setProjectWarningError(null)
    try {
      const result = await controller.acknowledgeProjectGeoJSONWarnings()
      if (result.failedCount > 0) {
        setProjectWarningError(
          result.failedCount === 1
            ? 'The acknowledgement could not be saved. This warning will remain until you try again.'
            : `${result.failedCount} acknowledgements could not be saved. Those warnings will remain until you try again.`,
        )
      }
    } catch {
      setProjectWarningError(
        'The acknowledgement could not be saved. This warning will remain until you try again.',
      )
    } finally {
      setIsAcknowledgingProjectWarnings(false)
    }
  }

  return (
    <>
      <IonModal
        isOpen={startupUi.showCompanionInfoModal}
        onDidDismiss={() => {
          if (!startupUi.companionInfoSuppressedByGate) {
            startupUi.handleCompanionModalDidDismiss()
          }
        }}
        canDismiss={startupUi.allowCompanionInfoModalDismiss}
        backdropDismiss={false}
        className="onboarding-modal"
      >
        <IonContent>
          <div className="md:hidden relative flex items-center justify-center min-h-full px-4 py-6">
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full bg-purple-500/20 blur-3xl" />
              <div className="absolute -bottom-16 right-0 w-60 h-60 rounded-full bg-indigo-500/20 blur-3xl" />
            </div>

            <div className="relative w-full max-w-md rounded-3xl border border-slate-700/80 bg-slate-900/95 p-6 sm:p-8 shadow-2xl shadow-purple-900/30 backdrop-blur text-center">
              <img src={logoPng} alt="SpeleoDB" className="w-full max-w-xs mx-auto mb-6" />

              <h2 className="text-2xl font-bold text-slate-100 mb-6">
                Your surveys, always with you
              </h2>
              <p className="text-slate-300 text-sm mb-2 font-bold">
                The SpeleoDB app is built for fieldwork.
              </p>
              <p className="text-slate-300 text-sm mb-6 font-bold">
                Online or Offline.
              </p>

              <div className="space-y-3 text-left mb-5">
                <div className="rounded-xl border border-slate-700/70 bg-slate-800/50 px-3 py-2">
                  <p className="text-sm font-medium text-slate-100">Sync all your SpeleoDB surveys to your phone</p>
                </div>
                <div className="rounded-xl border border-slate-700/70 bg-slate-800/50 px-3 py-2">
                  <p className="text-sm font-medium text-slate-100">Use Settings &gt; Sync to refresh when online</p>
                </div>
                <div className="rounded-xl border border-slate-700/70 bg-slate-800/50 px-3 py-2">
                  <p className="text-sm font-medium text-slate-100">Full offline access: no internet required.</p>
                </div>
              </div>

              <div className="rounded-2xl border border-purple-500/30 bg-purple-500/10 p-4 text-left mb-5">
                <p className="text-sm text-slate-200 font-medium mb-2">
                  Survey, publish to SpeleoDB, and sync to your phone in seconds.
                </p>
                <p className="text-sm text-slate-300 mt-4">
                  Visualize your surveys in the field, underground or even underwater.
                </p>
              </div>

              <p className="text-slate-300 text-sm mb-6">Have fun exploring.</p>

              <IonButton
                expand="block"
                className="font-semibold"
                onClick={startupUi.handleStartExploring}
              >
                Start exploring
              </IonButton>
            </div>
          </div>

          <div className="hidden md:flex min-h-full">
            <div className="relative w-2/5 flex flex-col items-center justify-center p-8 lg:p-12 overflow-hidden border-r border-slate-700/30">
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-950/40 via-slate-900 to-indigo-950/30" />
                <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[28rem] h-[28rem] rounded-full bg-purple-500/15 blur-3xl" />
                <div className="absolute bottom-1/4 -right-20 w-80 h-80 rounded-full bg-indigo-500/15 blur-3xl" />
              </div>

              <div className="relative text-center max-w-sm">
                <img src={logoPng} alt="SpeleoDB" className="w-full max-w-sm mx-auto mb-8" />
                <h2 className="text-3xl lg:text-4xl font-bold text-slate-100 mb-4 leading-tight">
                  Your surveys, always with you
                </h2>
                <p className="text-slate-300 text-base font-bold mb-1">
                  The SpeleoDB app is built for fieldwork.
                </p>
                <p className="text-slate-300 text-base font-bold">
                  Online or Offline.
                </p>
              </div>
            </div>

            <div className="w-3/5 flex flex-col items-center justify-center p-8 lg:p-12">
              <div className="w-full max-w-lg">
                <div className="space-y-3 mb-6">
                  <div className="rounded-xl border border-slate-700/70 bg-slate-800/50 px-4 py-3">
                    <p className="text-base font-medium text-slate-100">Sync all your SpeleoDB surveys to your device</p>
                  </div>
                  <div className="rounded-xl border border-slate-700/70 bg-slate-800/50 px-4 py-3">
                    <p className="text-base font-medium text-slate-100">Use Settings &gt; Sync to refresh when online</p>
                  </div>
                  <div className="rounded-xl border border-slate-700/70 bg-slate-800/50 px-4 py-3">
                    <p className="text-base font-medium text-slate-100">Full offline access: no internet required</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-purple-500/30 bg-purple-500/10 p-5 mb-6">
                  <p className="text-base text-slate-200 font-medium mb-3">
                    Survey, publish to SpeleoDB, and sync to your device in seconds.
                  </p>
                  <p className="text-sm text-slate-300">
                    Visualize your surveys in the field, underground or even underwater.
                  </p>
                </div>

                <p className="text-slate-300 text-sm mb-6 text-center">Have fun exploring.</p>

                <IonButton
                  expand="block"
                  className="font-semibold"
                  onClick={startupUi.handleStartExploring}
                >
                  Start exploring
                </IonButton>
              </div>
            </div>
          </div>
        </IonContent>
      </IonModal>

      <IonModal
        isOpen={startupUi.showOfflineModal}
        onDidDismiss={startupUi.handleOfflineModalDidDismiss}
        canDismiss={startupUi.allowOfflineModalDismiss}
        backdropDismiss={false}
      >
        <IonContent className="ion-padding">
          <div className="flex flex-col h-full justify-center max-w-sm mx-auto text-center">
            <div className="mb-6">
              <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-500/20 text-amber-400 mb-4">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </span>
              <h2 className="text-xl font-semibold text-slate-100 mb-2">Offline mode</h2>
              <p className="text-slate-400 text-sm">
                The app could not verify your session with the server. You are operating in offline mode.
              </p>
              <p className="text-slate-500 text-xs mt-3">
                To attempt reconnect, close and reopen the app. After reconnecting, use Settings &gt; Sync to refresh data.
              </p>
            </div>
            <IonButton expand="block" onClick={startupUi.acknowledgeOfflineMode}>
              Go Offline
            </IonButton>
          </div>
        </IonContent>
      </IonModal>

      <IonModal
        isOpen={startupUi.showProjectGeoJSONWarningModal}
        backdropDismiss={false}
        canDismiss={(_data, role) => Promise.resolve(
          role === undefined && !startupUi.showProjectGeoJSONWarningModal,
        )}
        aria-labelledby="project-geojson-warning-title"
        aria-describedby="project-geojson-warning-description"
        data-testid="project-geojson-warning-modal"
      >
        <IonContent className="ion-padding">
          <div className="flex flex-col min-h-full justify-center max-w-lg mx-auto">
            <div className="text-center mb-6">
              <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-500/20 text-amber-400 mb-4">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </span>
              <h2
                id="project-geojson-warning-title"
                className="text-xl font-semibold text-slate-100 mb-2"
              >
                Project map data disabled
              </h2>
              <p id="project-geojson-warning-description" className="text-slate-400 text-sm">
                {warningCount === 1
                  ? 'The following project GeoJSON file will not be displayed or used for offline map downloads.'
                  : `The following ${warningCount} project GeoJSON files will not be displayed or used for offline map downloads.`}
              </p>
            </div>
            <ul className="space-y-3 mb-6" aria-label="Disabled project map data">
              {projectGeoJSONWarnings.map((warning) => (
                <li
                  key={`${warning.projectId}:${warning.commitId}`}
                  className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4"
                >
                  <p className="font-semibold text-slate-100">{warning.projectName}</p>
                  <p className="text-xs text-slate-400 break-all">Project ID: {warning.projectId}</p>
                  <p className="text-sm text-slate-300 mt-2">{warningReason(warning)}</p>
                </li>
              ))}
            </ul>
            {projectWarningError && (
              <p
                role="alert"
                aria-live="assertive"
                className="text-sm text-red-300 mb-3 text-center"
                data-testid="project-geojson-warning-error"
              >
                {projectWarningError}
              </p>
            )}
            <IonButton
              expand="block"
              color="warning"
              disabled={isAcknowledgingProjectWarnings}
              aria-label="Acknowledge disabled project map data"
              data-testid="project-geojson-warning-acknowledge"
              onClick={() => { void acknowledgeProjectWarnings() }}
            >
              {isAcknowledgingProjectWarnings ? 'Saving…' : 'Acknowledge'}
            </IonButton>
          </div>
        </IonContent>
      </IonModal>

      <IonModal
        isOpen={startupUi.showStorageConsentModal}
        // A genuine dismissal (button, gesture, or controlled isOpen close after
        // a user choice) marks the prompt acknowledged so it never auto-reappears.
        // But when the modal is closed only because a higher-priority modal
        // (offline/companion/GeoJSON warning) took the slot, we must NOT
        // acknowledge -- otherwise
        // the user is silently opted out of the one-time popup. It re-shows once
        // the gate clears.
        // NOTE: do NOT set canDismiss={false} -- that also blocks the controlled
        // close, leaving the modal permanently stuck open.
        onDidDismiss={() => {
          if (!startupUi.storageConsentSuppressedByGate) {
            controller.acknowledgeStoragePrompt()
          }
        }}
        backdropDismiss={false}
        data-testid="storage-consent-modal"
      >
        <IonContent className="ion-padding">
          <div className="flex flex-col h-full justify-center max-w-sm mx-auto text-center">
            <div className="mb-6">
              <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-500/20 text-amber-400 mb-4">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 7v10a2 2 0 002 2h12a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H6a2 2 0 00-2 2z"
                  />
                </svg>
              </span>
              <h2 className="text-xl font-semibold text-slate-100 mb-2">More storage needed</h2>
              <p className="text-slate-400 text-sm">
                Caching your projects and landmarks for offline use needs more than{' '}
                {TILE_CACHE_CAP_MB} MB of device storage.
              </p>
              <p className="text-slate-500 text-xs mt-3">
                Allow SpeleoDB to use additional storage to finish caching maps, or keep the
                {` ${TILE_CACHE_CAP_MB} MB`} limit. You can change this later in Settings.
              </p>
            </div>
            <IonButton
              expand="block"
              color="warning"
              data-testid="storage-consent-allow"
              onClick={() => controller.approveTileCacheOverLimit()}
            >
              Allow more storage
            </IonButton>
            <IonButton
              expand="block"
              fill="outline"
              color="medium"
              className="mt-3"
              data-testid="storage-consent-decline"
              onClick={() => controller.acknowledgeStoragePrompt()}
            >
              Not now
            </IonButton>
          </div>
        </IonContent>
      </IonModal>
    </>
  )
}
