import { Redirect, Route, Switch } from 'react-router-dom';
import { IonApp, IonRouterOutlet, setupIonicReact } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';

import { SpeleoDBProvider } from './context/SpeleoDBProvider';

/* Pages */
import Home from './pages/Home';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';

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
  mode: 'ios', // Use iOS styling for consistent look
});

const App: React.FC = () => (
  <IonApp>
    <IonReactRouter>
      <SpeleoDBProvider>
        <IonRouterOutlet>
          <Switch>
            <Route exact path="/" component={Home} />
            <Route exact path="/login" component={Login} />
            <Route exact path="/dashboard" component={Dashboard} />
            {/* Fallback route */}
            <Route>
              <Redirect to="/" />
            </Route>
          </Switch>
        </IonRouterOutlet>
      </SpeleoDBProvider>
    </IonReactRouter>
  </IonApp>
);

export default App;
