import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import {
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonModal,
  IonPage,
  IonTitle,
  IonToggle,
  IonToolbar,
} from '@ionic/react';
import { syncOutline } from 'ionicons/icons';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

import { useSpeleoDB } from '../context/useSpeleoDB';
import { getManualTileCount, getTotalCacheBytes } from '../services/tileCache/TileCacheRepository';
import AppTabBar from '../components/AppTabBar';
import {
  setShowLandmarks as persistShowLandmarks,
} from '../services/PreferencesService';
import { restartGuidedTourFromHelp } from '../onboarding/guidedTour/engine';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

interface SettingsProps {
  showLandmarks: boolean;
  onShowLandmarksChange: (visible: boolean) => void;
  isProjectPanelOpen: boolean;
  onProjectPanelChange: (open: boolean) => void;
}

const Settings: React.FC<SettingsProps> = ({
  showLandmarks,
  onShowLandmarksChange,
  isProjectPanelOpen,
  onProjectPanelChange,
}) => {
  const history = useHistory();
  const location = useLocation();
  const { controller, projects, syncStatus, tilePrefetchJobs } = useSpeleoDB();

  const [cacheBytes, setCacheBytes] = useState(0);
  const [manualTileCount, setManualTileCount] = useState(0);
  const [showLogoutConfirmModal, setShowLogoutConfirmModal] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    if (!controller.isAuthenticated()) {
      history.push('/login');
    }
  }, [history, controller]);

  useEffect(() => {
    if (location.pathname !== '/settings') return;

    const refresh = () => {
      getTotalCacheBytes().then(setCacheBytes).catch(() => {});
      getManualTileCount().then(setManualTileCount).catch(() => {});
    };

    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [location.pathname]);

  const handleToggleLandmarks = useCallback(
    (checked: boolean) => {
      persistShowLandmarks(checked);
      onShowLandmarksChange(checked);
      Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    },
    [onShowLandmarksChange],
  );

  const handleSync = useCallback(async () => {
    try {
      await controller.syncProjects();
    } catch {
      // Sync failure is non-fatal; cache stats are still refreshed below.
    }
    getTotalCacheBytes().then(setCacheBytes).catch(() => {});
    getManualTileCount().then(setManualTileCount).catch(() => {});
  }, [controller]);

  const handleShowTutorial = useCallback(() => {
    onProjectPanelChange(false);
    history.push('/dashboard');
    void restartGuidedTourFromHelp();
  }, [history, onProjectPanelChange]);

  const handleLogout = useCallback(() => {
    setShowLogoutConfirmModal(true);
  }, []);

  const handleConfirmLogout = useCallback(async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await controller.logout();
      setShowLogoutConfirmModal(false);
      history.replace('/login');
    } catch {
      // Logout failed; keep modal open so user can retry or cancel.
    } finally {
      setIsLoggingOut(false);
    }
  }, [controller, history, isLoggingOut]);

  const geoJsonProjectCount = useMemo(
    () => projects.filter((p) => !p.exclude_geojson && Boolean(p.geojson_file)).length,
    [projects],
  );

  let prefetchTotal = 0;
  let prefetchDone = 0;
  for (const job of tilePrefetchJobs) {
    prefetchTotal += job.totalTiles;
    prefetchDone += job.completedTiles + job.failedTiles;
  }
  const syncTotalTiles = prefetchTotal + manualTileCount;
  const syncProcessedTiles = prefetchDone + manualTileCount;
  const syncPct = syncTotalTiles > 0 ? Math.floor((syncProcessedTiles / syncTotalTiles) * 100) : 0;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Settings</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent>
        {/* Synchronization Status */}
        <IonList inset>
          <IonListHeader>
            <IonLabel>Synchronization</IonLabel>
            <button
              onClick={handleSync}
              disabled={syncStatus === 'syncing'}
              data-testid="sync-button"
              className="ml-auto mr-2 w-8 h-8 flex items-center justify-center rounded-lg
                         text-slate-300 hover:text-white hover:bg-slate-700/50
                         disabled:opacity-50 transition-colors"
              aria-label="Sync projects"
            >
              {syncStatus === 'syncing' ? (
                <div className="w-4 h-4 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
              ) : (
                <IonIcon icon={syncOutline} className="text-lg" />
              )}
            </button>
          </IonListHeader>

          <IonItem>
            <IonLabel>Synced projects</IonLabel>
            <span slot="end" className="text-sm text-slate-400" data-testid="synced-projects">
              {formatNumber(geoJsonProjectCount)}
            </span>
          </IonItem>

          <IonItem>
            <IonLabel>Cache size</IonLabel>
            <span slot="end" className="text-sm text-slate-400" data-testid="cache-size">
              {formatBytes(cacheBytes)}
            </span>
          </IonItem>

          <IonItem>
            <IonLabel>Sync progress</IonLabel>
            <span slot="end" className="text-sm text-slate-400" data-testid="sync-pct">
              {syncPct}%
            </span>
          </IonItem>

          <IonItem>
            <IonLabel>Tiles synced</IonLabel>
            <span slot="end" className="text-sm text-slate-400" data-testid="sync-tiles">
              {formatNumber(syncProcessedTiles)} / {formatNumber(syncTotalTiles)}
            </span>
          </IonItem>
        </IonList>

        {/* Map Settings */}
        <IonList inset>
          <IonListHeader>
            <IonLabel>Map Settings</IonLabel>
          </IonListHeader>

          <IonItem>
            <IonToggle
              checked={showLandmarks}
              onIonChange={(e) => handleToggleLandmarks(e.detail.checked)}
              data-testid="landmark-toggle"
            >
              Show landmarks
            </IonToggle>
          </IonItem>
        </IonList>

        {/* Tutorial */}
        <IonList inset>
          <IonItem
            button
            detail={false}
            onClick={handleShowTutorial}
            className="ion-text-center"
            data-testid="show-tutorial-button"
          >
            <IonLabel className="ion-text-center">
              Show Tutorial
            </IonLabel>
          </IonItem>
        </IonList>

        {/* Account */}
        <IonList inset>
          <IonItem
            button
            detail={false}
            onClick={handleLogout}
            className="ion-text-center"
            data-testid="sign-out-button"
          >
            <IonLabel color="danger" className="ion-text-center">
              Sign Out
            </IonLabel>
          </IonItem>
        </IonList>

        {/* Logout confirmation modal */}
        <IonModal
          isOpen={showLogoutConfirmModal}
          onDidDismiss={() => setShowLogoutConfirmModal(false)}
          canDismiss={!isLoggingOut}
          backdropDismiss={!isLoggingOut}
        >
          <IonContent className="ion-padding">
            <div className="flex flex-col h-full justify-center max-w-sm mx-auto text-center">
              <div className="mb-6">
                <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-red-500/20 text-red-300 mb-4">
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-7.938 4h15.876c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L2.33 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </span>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">Clear local data and sign out?</h2>
                <p className="text-slate-300 text-sm mb-2">
                  All local data will be cleared immediately from this device.
                </p>
                <p className="text-slate-400 text-sm">
                  This includes cached maps, GeoJSON, projects, and offline credentials. You will not be able to reconnect without network access.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <button
                  type="button"
                  disabled={isLoggingOut}
                  onClick={() => setShowLogoutConfirmModal(false)}
                  className="px-4 py-3 rounded-xl bg-slate-800/70 text-slate-200 hover:bg-slate-700/70 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isLoggingOut}
                  onClick={handleConfirmLogout}
                  className="px-4 py-3 rounded-xl bg-red-600 text-white hover:bg-red-500 disabled:opacity-50 transition-colors"
                >
                  {isLoggingOut ? 'Clearing data\u2026' : 'Wipe local data & Sign Out'}
                </button>
              </div>
            </div>
          </IonContent>
        </IonModal>
      </IonContent>
      <IonFooter className="ion-no-border">
        <AppTabBar
          isProjectPanelOpen={isProjectPanelOpen}
          onProjectPanelChange={onProjectPanelChange}
        />
      </IonFooter>
    </IonPage>
  );
};

export default Settings;
