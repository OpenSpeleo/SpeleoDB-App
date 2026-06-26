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
  const [isProjectPanelOpen, setIsProjectPanelOpen] = useState(false)
  const [isLandmarkPanelOpen, setIsLandmarkPanelOpen] = useState(false)
  const [isGpsPanelOpen, setIsGpsPanelOpen] = useState(false)
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

  // The project, landmark, and GPS panels share the same left-edge slot, so
  // opening one closes the others (they are mutually exclusive).
  const handleProjectPanelChange = (open: boolean) => {
    setIsProjectPanelOpen(open)
    if (open) {
      setIsLandmarkPanelOpen(false)
      setIsGpsPanelOpen(false)
    }
  }

  const handleLandmarkPanelChange = (open: boolean) => {
    setIsLandmarkPanelOpen(open)
    if (open) {
      setIsProjectPanelOpen(false)
      setIsGpsPanelOpen(false)
    }
  }

  const handleGpsPanelChange = (open: boolean) => {
    setIsGpsPanelOpen(open)
    if (open) {
      setIsProjectPanelOpen(false)
      setIsLandmarkPanelOpen(false)
    }
  }

  return (
    <>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          visibility: isDashboard ? 'visible' : 'hidden',
          pointerEvents: isDashboard ? 'auto' : 'none',
        }}
      >
        <Suspense fallback={null}>
          <Dashboard
            isProjectPanelOpen={isProjectPanelOpen}
            onProjectPanelChange={handleProjectPanelChange}
            isLandmarkPanelOpen={isLandmarkPanelOpen}
            onLandmarkPanelChange={handleLandmarkPanelChange}
            isGpsPanelOpen={isGpsPanelOpen}
            onGpsPanelChange={handleGpsPanelChange}
            showLandmarks={showLandmarks}
            colorMode={colorMode}
            measurementUnit={measurementUnit}
            selectedMapLayerId={selectedMapLayerId}
            onSelectedMapLayerIdChange={setSelectedMapLayerId}
            layerOfflineSync={layerOfflineSync}
          />
        </Suspense>
      </div>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          visibility: isSettings ? 'visible' : 'hidden',
          pointerEvents: isSettings ? 'auto' : 'none',
        }}
      >
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
            isProjectPanelOpen={isProjectPanelOpen}
            onProjectPanelChange={handleProjectPanelChange}
            isLandmarkPanelOpen={isLandmarkPanelOpen}
            onLandmarkPanelChange={handleLandmarkPanelChange}
            isGpsPanelOpen={isGpsPanelOpen}
            onGpsPanelChange={handleGpsPanelChange}
          />
        </Suspense>
      </div>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          visibility: isPending ? 'visible' : 'hidden',
          pointerEvents: isPending ? 'auto' : 'none',
        }}
      >
        <Suspense fallback={null}>
          <PendingOps
            isProjectPanelOpen={isProjectPanelOpen}
            onProjectPanelChange={handleProjectPanelChange}
            isLandmarkPanelOpen={isLandmarkPanelOpen}
            onLandmarkPanelChange={handleLandmarkPanelChange}
            isGpsPanelOpen={isGpsPanelOpen}
            onGpsPanelChange={handleGpsPanelChange}
          />
        </Suspense>
      </div>
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
 * Keeps Dashboard + Settings + Pending mounted behind the authenticated shell
 * so map state survives tab switches, while allowing the whole shell to load lazily.
 */
export default function AuthenticatedAppShell(): ReactNode {
  return (
    <IonApp>
      <AuthenticatedRoutes />
    </IonApp>
  )
}
