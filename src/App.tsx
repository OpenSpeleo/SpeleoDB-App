import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { IonApp, setupIonicReact } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';

import { App as CapApp } from '@capacitor/app';
import { SpeleoDBProvider } from './context/SpeleoDBProvider';
import { getColorMode, getMeasurementUnit, getShowLandmarks } from './services/PreferencesService';

/* Pages */
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';

/* Core CSS required for Ionic components to work properly */
import '@ionic/react/css/core.css';

/* Basic CSS for apps built with Ionic */
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';

/* Optional CSS utils that can be commented out */
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

/**
 * Ionic Dark Mode
 * -----------------------------------------------------
 * For more info, please see:
 * https://ionicframework.com/docs/theming/dark-mode
 */
import '@ionic/react/css/palettes/dark.always.css';

/* Theme variables */
import './theme/variables.css';

/* Custom TailwindCSS styles */
import './index.css';

setupIonicReact({
  mode: 'ios',
});

/**
 * Renders the login page for unauthenticated routes, or keeps
 * Dashboard + Settings both mounted (hiding the inactive one)
 * so map state survives tab switches.
 */
const AppRoutes: React.FC = () => {
  const location = useLocation();
  const path = location.pathname;
  const isDashboard = path === '/dashboard';
  const isSettings = path === '/settings';
  const isAuthenticated = isDashboard || isSettings;
  const [isProjectPanelOpen, setIsProjectPanelOpen] = useState(false);
  const [showLandmarks, setShowLandmarks] = useState(() => getShowLandmarks());
  const [colorMode, setColorMode] = useState(() => getColorMode());
  const [measurementUnit, setMeasurementUnit] = useState(() => getMeasurementUnit());

  if (path === '/login') {
    return <Login />;
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <>
      <div style={{
        position: 'fixed', inset: 0,
        visibility: isDashboard ? 'visible' : 'hidden',
        pointerEvents: isDashboard ? 'auto' : 'none',
      }}>
        <Dashboard
          isProjectPanelOpen={isProjectPanelOpen}
          onProjectPanelChange={setIsProjectPanelOpen}
          showLandmarks={showLandmarks}
          colorMode={colorMode}
          measurementUnit={measurementUnit}
        />
      </div>
      <div style={{
        position: 'fixed', inset: 0,
        visibility: isSettings ? 'visible' : 'hidden',
        pointerEvents: isSettings ? 'auto' : 'none',
      }}>
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
      </div>
    </>
  );
};

const App: React.FC = () => {
  useEffect(() => {
    const listener = CapApp.addListener('appUrlOpen', (event) => {
      console.debug('[DeepLink] opened via:', event.url);
    });
    return () => { listener.then((h) => h.remove()); };
  }, []);

  return (
    <IonApp>
      <IonReactRouter>
        <SpeleoDBProvider>
          <AppRoutes />
        </SpeleoDBProvider>
      </IonReactRouter>
    </IonApp>
  );
};

export default App;
