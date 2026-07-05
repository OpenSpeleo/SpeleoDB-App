import { Suspense, lazy, useContext, useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { IonApp, setupIonicReact } from '@ionic/react'

import { SpeleoDBContext } from './context/useSpeleoDB'
import {
  getColorMode,
  getLayerOfflineSyncPreferences,
  getMeasurementUnit,
  getSelectedMapLayerId,
  getShowLandmarks,
} from './services/PreferencesService'
import type { DashboardPanel } from './types/dashboardPanel'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Settings = lazy(() => import('./pages/Settings'))
const PendingOps = lazy(() => import('./pages/PendingOps'))

setupIonicReact({
  mode: 'ios',
})

function AuthenticatedRoutes(): ReactNode {
  const speleo = useContext(SpeleoDBContext)
  const path = useLocation().pathname
  const isDashboard = path === '/dashboard'
  const isSettings = path === '/settings'
  const isPending = path === '/pending'
  const [activeDashboardPanel, setActiveDashboardPanel] = useState<DashboardPanel>(null)
  const [showLandmarks, setShowLandmarks] = useState(() => getShowLandmarks())
  const [colorMode, setColorMode] = useState(() => getColorMode())
  const [measurementUnit, setMeasurementUnit] = useState(() => getMeasurementUnit())
  const [selectedMapLayerId, setSelectedMapLayerId] = useState(() => getSelectedMapLayerId())
  const [layerOfflineSync, setLayerOfflineSync] = useState(() =>
    getLayerOfflineSyncPreferences(),
  )
  const [gpsErrorToast, setGpsErrorToast] = useState<string | null>(null)
  const gpsRecordingError = speleo?.gpsRecordingError ?? null
  const controller = speleo?.controller

  useEffect(() => {
    if (!gpsRecordingError || !controller) return
    const message = gpsRecordingError
    queueMicrotask(() => {
      setGpsErrorToast(message)
      controller.clearGpsRecordingError()
    })
  }, [controller, gpsRecordingError])

  useEffect(() => {
    if (!gpsErrorToast) return
    const timeout = window.setTimeout(() => setGpsErrorToast(null), 4000)
    return () => window.clearTimeout(timeout)
  }, [gpsErrorToast])

  return (
    <>
      <div
        aria-hidden={!isDashboard}
        style={{
          position: 'fixed',
          inset: 0,
          visibility: isDashboard ? 'visible' : 'hidden',
          pointerEvents: isDashboard ? 'auto' : 'none',
        }}
      >
        <Suspense fallback={null}>
          <Dashboard
            isActive={isDashboard}
            activeDashboardPanel={activeDashboardPanel}
            onDashboardPanelChange={setActiveDashboardPanel}
            showLandmarks={showLandmarks}
            colorMode={colorMode}
            measurementUnit={measurementUnit}
            selectedMapLayerId={selectedMapLayerId}
            onSelectedMapLayerIdChange={setSelectedMapLayerId}
            layerOfflineSync={layerOfflineSync}
          />
        </Suspense>
      </div>
      {isSettings && (
        <div className="fixed inset-0">
          <Suspense fallback={null}>
            <Settings
              showLandmarks={showLandmarks}
              onShowLandmarksChange={setShowLandmarks}
              colorMode={colorMode}
              onColorModeChange={setColorMode}
              measurementUnit={measurementUnit}
              onMeasurementUnitChange={setMeasurementUnit}
              layerOfflineSync={layerOfflineSync}
              onLayerOfflineSyncChange={setLayerOfflineSync}
              activeDashboardPanel={activeDashboardPanel}
              onDashboardPanelChange={setActiveDashboardPanel}
            />
          </Suspense>
        </div>
      )}
      {isPending && (
        <div className="fixed inset-0">
          <Suspense fallback={null}>
            <PendingOps
              activeDashboardPanel={activeDashboardPanel}
              onDashboardPanelChange={setActiveDashboardPanel}
            />
          </Suspense>
        </div>
      )}
      {gpsErrorToast && (
        <div
          data-testid="gps-recording-error-toast"
          className="fixed left-1/2 bottom-24 z-[10000] -translate-x-1/2 rounded-lg bg-red-600 px-4 py-2 text-sm text-white shadow-lg"
        >
          {gpsErrorToast}
        </div>
      )}
    </>
  )
}

/**
 * Keeps only Dashboard mounted behind the authenticated shell so expensive map
 * state survives tab switches. Non-map pages mount only for their active route.
 */
export default function AuthenticatedAppShell(): ReactNode {
  return (
    <IonApp>
      <AuthenticatedRoutes />
    </IonApp>
  )
}
