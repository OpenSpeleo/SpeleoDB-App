import { Suspense, lazy, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { IonApp, setupIonicReact } from '@ionic/react'

import {
  getColorMode,
  getMeasurementUnit,
  getShowLandmarks,
} from './services/PreferencesService'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Settings = lazy(() => import('./pages/Settings'))

setupIonicReact({
  mode: 'ios',
})

function AuthenticatedRoutes(): ReactNode {
  const path = useLocation().pathname
  const isDashboard = path === '/dashboard'
  const isSettings = path === '/settings'
  const [isProjectPanelOpen, setIsProjectPanelOpen] = useState(false)
  const [showLandmarks, setShowLandmarks] = useState(() => getShowLandmarks())
  const [colorMode, setColorMode] = useState(() => getColorMode())
  const [measurementUnit, setMeasurementUnit] = useState(() => getMeasurementUnit())

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
            onProjectPanelChange={setIsProjectPanelOpen}
            showLandmarks={showLandmarks}
            colorMode={colorMode}
            measurementUnit={measurementUnit}
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
            isProjectPanelOpen={isProjectPanelOpen}
            onProjectPanelChange={setIsProjectPanelOpen}
          />
        </Suspense>
      </div>
    </>
  )
}

/**
 * Keeps Dashboard + Settings mounted behind the authenticated shell so map
 * state survives tab switches, while allowing the whole shell to load lazily.
 */
export default function AuthenticatedAppShell(): ReactNode {
  return (
    <IonApp>
      <AuthenticatedRoutes />
    </IonApp>
  )
}
