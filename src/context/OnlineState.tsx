import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { IonModal, IonContent, IonButton } from '@ionic/react';
import { authService } from '../services/AuthService';
import { getPreferences, clearPreferences } from '../services/PreferencesService';

export interface OnlineStateValue {
  /** True when the server responded 2xx to token validation or login; false when unreachable or not yet validated. */
  isOnline: boolean;
  setOnline: (value: boolean) => void;
  showOfflineModal: boolean;
  setShowOfflineModal: (show: boolean) => void;
}

const OnlineStateContext = createContext<OnlineStateValue | null>(null);

export function useOnlineState(): OnlineStateValue {
  const ctx = useContext(OnlineStateContext);
  if (!ctx) {
    throw new Error('useOnlineState must be used within OnlineStateProvider');
  }
  return ctx;
}

interface OnlineStateProviderProps {
  children: React.ReactNode;
}

/**
 * At app open: if user has email & token, redirect to dashboard and validate token with server.
 * - 40X → clear preferences, redirect to home
 * - Can't reach server → set offline, show warning modal
 * - 20X → set online (global boolean)
 */
export function OnlineStateProvider({ children }: OnlineStateProviderProps) {
  const history = useHistory();
  const location = useLocation();
  const [isOnline, setOnline] = useState(false);
  const [showOfflineModal, setShowOfflineModal] = useState(false);
  const didValidateRef = useRef(false);

  useEffect(() => {
    const prefs = getPreferences();
    const hasCredentials = Boolean(prefs.email?.trim() && prefs.token?.trim());

    if (!hasCredentials) return;

    const pathname = location.pathname;
    if (pathname === '/' || pathname === '/login') {
      history.replace('/dashboard');
    }

    if (didValidateRef.current) return;
    didValidateRef.current = true;

    authService.validateStoredToken().then((result) => {
      if (result === 'unauthorized') {
        clearPreferences();
        authService.logout();
        history.replace('/');
        return;
      }
      if (result === 'ok') {
        setOnline(true);
        return;
      }
      // network_error
      setOnline(false);
      setShowOfflineModal(true);
    });
  }, [history, location.pathname]);

  const value: OnlineStateValue = {
    isOnline,
    setOnline: useCallback((value: boolean) => setOnline(value), []),
    showOfflineModal,
    setShowOfflineModal: useCallback((show: boolean) => setShowOfflineModal(show), []),
  };

  return (
    <OnlineStateContext.Provider value={value}>
      {children}
      <IonModal
        isOpen={showOfflineModal}
        onDidDismiss={() => setShowOfflineModal(false)}
        initialBreakpoint={0.5}
        breakpoints={[0, 0.5]}
      >
        <IonContent className="ion-padding">
          <div className="flex flex-col h-full justify-center max-w-sm mx-auto text-center">
            <div className="mb-6">
              <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-500/20 text-amber-400 mb-4">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </span>
              <h2 className="text-xl font-semibold text-slate-100 mb-2">Offline mode</h2>
              <p className="text-slate-400 text-sm">
                The app could not reach the server. You are operating in offline mode. Some features may be limited.
              </p>
            </div>
            <IonButton expand="block" onClick={() => setShowOfflineModal(false)}>
              OK
            </IonButton>
          </div>
        </IonContent>
      </IonModal>
    </OnlineStateContext.Provider>
  );
}
