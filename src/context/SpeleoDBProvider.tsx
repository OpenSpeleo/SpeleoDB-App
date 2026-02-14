/**
 * SpeleoDBProvider -- React bridge for the SpeleoDBController.
 *
 * Creates the controller once, subscribes via useSyncExternalStore, and
 * exposes everything through the useSpeleoDB() hook. Replaces the old
 * OnlineStateProvider.
 */

import React, { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { IonModal, IonContent, IonButton } from '@ionic/react';
import logoPng from '../assets/media/logo.png';

import { HttpClient } from '../services/HttpClient';
import { SpeleoDBService } from '../services/SpeleoDBService';
import { ProjectCacheService } from '../services/ProjectCacheService';
import {
  getPreferences,
  setPreferences,
  clearPreferences,
} from '../services/PreferencesService';
import { SpeleoDBController } from '../controllers/SpeleoDBController';
import type { SyncStatus } from '../controllers/SpeleoDBController';
import type { AuthState } from '../types';
import type { Project } from '../types/project';
import type { TilePrefetchJobState } from '../types/tilePrefetch';

// ==================== Context value shape ====================

export interface SpeleoDBContextValue {
  controller: SpeleoDBController;
  authState: AuthState;
  isOnline: boolean;
  projects: Project[];
  syncStatus: SyncStatus;
  tilePrefetchJobs: TilePrefetchJobState[];
}

const SpeleoDBContext = createContext<SpeleoDBContextValue | null>(null);

// ==================== Hook ====================

export function useSpeleoDB(): SpeleoDBContextValue {
  const ctx = useContext(SpeleoDBContext);
  if (!ctx) {
    throw new Error('useSpeleoDB must be used within SpeleoDBProvider');
  }
  return ctx;
}

// ==================== Provider ====================

interface SpeleoDBProviderProps {
  children: React.ReactNode;
}

export function SpeleoDBProvider({ children }: SpeleoDBProviderProps) {
  const history = useHistory();
  const location = useLocation();
  const didValidateRef = useRef(false);

  // ---- Create controller once (stable across re-renders) --------------------

  const controllerRef = useRef<SpeleoDBController | null>(null);
  if (!controllerRef.current) {
    const http = new HttpClient();
    const service = new SpeleoDBService(http);
    const projectCache = new ProjectCacheService();
    controllerRef.current = new SpeleoDBController(
      service,
      { getPreferences, setPreferences, clearPreferences },
      projectCache,
    );
  }
  const controller = controllerRef.current;

  // ---- Subscribe to controller state via useSyncExternalStore ---------------

  const authState = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.authState,
  );

  const isOnline = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.isOnline,
  );

  const projects = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.projects,
  );

  const syncStatus = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.syncStatus,
  );

  const tilePrefetchJobs = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.tilePrefetchJobs,
  );

  // ---- Offline modal local state -------------------------------------------
  const [showOfflineModal, setShowOfflineModal] = React.useState(false);
  const [allowOfflineModalDismiss, setAllowOfflineModalDismiss] = React.useState(false);
  const [showCompanionInfoModal, setShowCompanionInfoModal] = React.useState(false);
  const [allowCompanionInfoModalDismiss, setAllowCompanionInfoModalDismiss] = React.useState(false);
  const previousAuthStateRef = useRef(authState.isAuthenticated);
  const shouldOpenCompanionInfoRef = useRef(false);

  // ---- Startup: redirect + validate stored token ---------------------------

  useEffect(() => {
    const prefs = getPreferences();
    const hasCredentials = Boolean(prefs.email?.trim() && prefs.token?.trim());

    if (!hasCredentials) return;

    // If user has credentials and is on a public page, go to dashboard.
    const pathname = location.pathname;
    if (pathname === '/' || pathname === '/login') {
      history.replace('/dashboard');
    }

    // Validate once per app lifetime.
    if (didValidateRef.current) return;
    didValidateRef.current = true;

    controller.validateSession().then((result) => {
      if (result === 'unauthorized') {
        clearPreferences();
        controller.logout();
        history.replace('/');
        return;
      }
      if (result === 'ok') {
        // isOnline is updated inside the controller; React picks it up via useSyncExternalStore.
        return;
      }
      // network_error
      setAllowOfflineModalDismiss(false);
      setShowOfflineModal(true);
    });
  }, [history, location.pathname, controller]);

  // ---- Companion info modal (show once right after login) ------------------

  useEffect(() => {
    const wasAuthenticated = previousAuthStateRef.current;
    const isAuthenticated = authState.isAuthenticated;

    if (!wasAuthenticated && isAuthenticated) {
      shouldOpenCompanionInfoRef.current = true;
    } else if (wasAuthenticated && !isAuthenticated) {
      shouldOpenCompanionInfoRef.current = false;
      setShowCompanionInfoModal(false);
      setAllowCompanionInfoModalDismiss(false);
    }

    previousAuthStateRef.current = isAuthenticated;
  }, [authState.isAuthenticated]);

  useEffect(() => {
    if (
      shouldOpenCompanionInfoRef.current &&
      authState.isAuthenticated &&
      location.pathname === '/dashboard'
    ) {
      setAllowCompanionInfoModalDismiss(false);
      setShowCompanionInfoModal(true);
      shouldOpenCompanionInfoRef.current = false;
    }
  }, [authState.isAuthenticated, location.pathname]);

  // ---- Render ---------------------------------------------------------------

  const value: SpeleoDBContextValue = {
    controller,
    authState,
    isOnline,
    projects,
    syncStatus,
    tilePrefetchJobs,
  };

  return (
    <SpeleoDBContext.Provider value={value}>
      {children}

      {/* Companion onboarding modal */}
      <IonModal
        isOpen={showCompanionInfoModal}
        onDidDismiss={() => {
          setShowCompanionInfoModal(false);
          setAllowCompanionInfoModalDismiss(false);
        }}
        canDismiss={allowCompanionInfoModalDismiss}
        backdropDismiss={false}
      >
        <IonContent className="ion-padding">
          <div className="relative flex items-center justify-center min-h-full py-6">
            <div className="absolute inset-0 pointer-events-none">
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
                  <p className="text-sm font-medium text-slate-100">Sync all your SpeleoDB data to your phone</p>
                </div>
                <div className="rounded-xl border border-slate-700/70 bg-slate-800/50 px-3 py-2">
                  <p className="text-sm font-medium text-slate-100">Pull down anytime to refresh</p>
                </div>
                <div className="rounded-xl border border-slate-700/70 bg-slate-800/50 px-3 py-2">
                  <p className="text-sm font-medium text-slate-100">Everything stays on your phoner: full offline access</p>
                </div>
              </div>

              <div className="rounded-2xl border border-purple-500/30 bg-purple-500/10 p-4 text-left mb-5">
                <p className="text-sm text-slate-200 font-medium mb-2">
                  Survey in the field, publish to SpeleoDB, then sync to your phone in seconds.
                </p>
                <p className="text-sm text-slate-300 mt-4">
                  You can now visualize your survey in the jungle or even underwater.
                </p>
              </div>

              <p className="text-slate-300 text-sm mb-6">Have fun exploring.</p>

              <IonButton
                expand="block"
                className="font-semibold"
                onClick={() => {
                  setAllowCompanionInfoModalDismiss(true);
                  setShowCompanionInfoModal(false);
                }}
              >
                Start exploring
              </IonButton>
            </div>
          </div>
        </IonContent>
      </IonModal>

      {/* Offline warning modal */}
      <IonModal
        isOpen={showOfflineModal}
        onDidDismiss={() => {
          setShowOfflineModal(false);
          setAllowOfflineModalDismiss(false);
        }}
        canDismiss={allowOfflineModalDismiss}
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
                The app could not reach the server. You are operating in offline mode. Some features may be limited.
              </p>
            </div>
            <IonButton
              expand="block"
              onClick={() => {
                setAllowOfflineModalDismiss(true);
                setShowOfflineModal(false);
              }}
            >
              OK
            </IonButton>
          </div>
        </IonContent>
      </IonModal>
    </SpeleoDBContext.Provider>
  );
}
