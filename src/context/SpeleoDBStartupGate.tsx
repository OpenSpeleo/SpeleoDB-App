import { lazy, Suspense, useCallback, type ReactNode } from 'react'
import { useHistory, useLocation } from 'react-router-dom'
import { SplashScreen } from '@capacitor/splash-screen'

import { getPreferences } from '../services/PreferencesService'
import { useStartupUiCoordinator } from './useStartupUiCoordinator'
import { useSpeleoDB } from './useSpeleoDB'

const SpeleoDBStartupModals = lazy(async () => {
  const [{ setupIonicReact }, modals] = await Promise.all([
    import('@ionic/react'),
    import('./SpeleoDBStartupModals'),
  ])
  setupIonicReact({ mode: 'ios' })
  return { default: modals.SpeleoDBStartupModals }
})

/**
 * Always-mounted startup shell: splash dismissal, session validation, and the
 * connecting banner stay in the main graph. Heavier Ionic modals load lazily once
 * the user is authenticated or a modal must be shown.
 */
export function SpeleoDBStartupGate(): ReactNode {
  const history = useHistory()
  const location = useLocation()
  const {
    authState,
    controller,
    isOfflineLocked,
    syncStatus,
    storageConsentRequired,
    projectGeoJSONWarnings = [],
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
    storageConsentRequired,
    hasProjectGeoJSONWarnings: projectGeoJSONWarnings.length > 0,
  })

  const shouldLoadModals =
    authState.isAuthenticated ||
    startupUi.showOfflineModal ||
    startupUi.showCompanionInfoModal ||
    startupUi.showProjectGeoJSONWarningModal ||
    startupUi.showStorageConsentModal

  return (
    <>
      {shouldLoadModals && (
        <Suspense fallback={null}>
          <SpeleoDBStartupModals startupUi={startupUi} />
        </Suspense>
      )}

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
