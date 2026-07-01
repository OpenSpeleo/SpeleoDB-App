import { useCallback, useEffect, type ReactNode } from 'react'
import { useHistory, useLocation } from 'react-router-dom'
import { IonButton, IonContent, IonModal } from '@ionic/react'
import { SplashScreen } from '@capacitor/splash-screen'

import logoPng from '../assets/media/logo.png'
import { getPreferences } from '../services/PreferencesService'
import { useStartupUiCoordinator } from './useStartupUiCoordinator'
import { useSpeleoDB } from './useSpeleoDB'

export function SpeleoDBStartupUi(): ReactNode {
  const history = useHistory()
  const location = useLocation()
  const {
    authState,
    controller,
    isOfflineLocked,
    syncStatus,
  } = useSpeleoDB()

  const hideSplashScreenSafely = useCallback((reason: string) => {
    SplashScreen.hide().catch((error) => {
      console.warn(`[splash] Failed to hide splash screen (${reason}).`, error)
    })
  }, [])

  const startupUi = useStartupUiCoordinator({
    authState,
    isOfflineLocked,
    syncStatus,
    controller,
    history,
    location,
    getPreferences,
    hideSplashScreenSafely,
  })

  useEffect(() => {
    if (!authState.isAuthenticated) return
    void controller.preloadOfflineMaps()
  }, [authState.isAuthenticated, controller])

  return (
    <>
      <IonModal
        isOpen={startupUi.showCompanionInfoModal}
        onDidDismiss={startupUi.handleCompanionModalDidDismiss}
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

      {startupUi.showConnectingBanner && (
        <div
          data-testid="connecting-banner"
          role="status"
          aria-live="polite"
          className="fixed left-1/2 -translate-x-1/2 bottom-8 z-[10000]
                     flex items-center gap-3 px-4 py-2 rounded-full
                     bg-slate-900/95 border border-slate-700 shadow-lg
                     pointer-events-none"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 2rem)' }}
        >
          <div
            className="w-4 h-4 border-2 border-slate-300 border-t-transparent
                       rounded-full animate-spin"
            aria-hidden="true"
          />
          <span className="text-sm text-slate-100">
            {'Connecting to SpeleoDB\u2026'}
          </span>
        </div>
      )}
    </>
  )
}
