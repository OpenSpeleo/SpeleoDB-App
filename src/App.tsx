import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';

import { App as CapApp } from '@capacitor/app';
import { SpeleoDBProvider } from './context/SpeleoDBProvider';

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

const Login = lazy(() => import('./pages/Login'))
const AuthenticatedAppShell = lazy(() => import('./AuthenticatedAppShell'))

/**
 * Renders the login route directly and lazy-loads the authenticated
 * shell only for dashboard/settings/pending paths.
 */
const AppRoutes: React.FC = () => {
  const path = useLocation().pathname;
  const isAuthenticatedRoute =
    path === '/dashboard' || path === '/settings' || path === '/pending';

  if (!isAuthenticatedRoute) {
    return (
      <Suspense fallback={null}>
        <Login />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={null}>
      <AuthenticatedAppShell />
    </Suspense>
  );
};

const App: React.FC = () => {
  useEffect(() => {
    const listener = CapApp.addListener('appUrlOpen', () => {
      // The full URL may contain signed paths, reset tokens, or user data.
      console.debug('[DeepLink] URL received.');
    });
    return () => { listener.then((h) => h.remove()); };
  }, []);

  return (
    <BrowserRouter>
      <SpeleoDBProvider>
        <AppRoutes />
      </SpeleoDBProvider>
    </BrowserRouter>
  );
};

export default App;
