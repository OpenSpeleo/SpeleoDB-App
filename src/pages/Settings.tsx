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
import { chevronDownOutline, syncOutline, warningOutline } from 'ionicons/icons';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

import { useSpeleoDB } from '../context/useSpeleoDB';
import { MAP, MAP_LAYERS } from '../constants';
import { getManualTileCount, getTotalCacheBytes } from '../services/tileCache/TileCacheRepository';
import AppTabBar from '../components/AppTabBar';
import {
  setColorMode as persistColorMode,
  setMeasurementUnit as persistMeasurementUnit,
  setShowLandmarks as persistShowLandmarks,
} from '../services/PreferencesService';
import { restartGuidedTourFromHelp } from '../onboarding/guidedTour/runtime';
import { isMapColorMode, DEFAULT_MAP_COLOR_MODE, type MapColorMode } from '../types/mapColorMode';
import { isMeasurementUnit, DEFAULT_MEASUREMENT_UNIT, type MeasurementUnit } from '../types/measurementUnit';
import { formatLastSync } from '../utils/formatLastSync';

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

const MAP_SELECT_CLASS = 'appearance-none min-w-[148px] rounded-lg border border-slate-500/70 bg-slate-800/90 text-sm text-slate-100 px-3 py-2 pr-9 shadow-inner shadow-black/20 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-cyan-400/60 focus:border-cyan-400/60';

const TILE_CACHE_CAP_MB = Math.round(MAP.TILE_CACHE_MAX_BYTES / (1024 * 1024));

interface SettingsProps {
  showLandmarks: boolean;
  onShowLandmarksChange: (visible: boolean) => void;
  colorMode: MapColorMode;
  onColorModeChange: (mode: MapColorMode) => void;
  measurementUnit: MeasurementUnit;
  onMeasurementUnitChange: (unit: MeasurementUnit) => void;
  layerOfflineSync: Record<string, boolean>;
  onLayerOfflineSyncChange: (next: Record<string, boolean>) => void;
  isProjectPanelOpen: boolean;
  onProjectPanelChange: (open: boolean) => void;
  isLandmarkPanelOpen: boolean;
  onLandmarkPanelChange: (open: boolean) => void;
}

const Settings: React.FC<SettingsProps> = ({
  showLandmarks,
  onShowLandmarksChange,
  colorMode,
  onColorModeChange,
  measurementUnit,
  onMeasurementUnitChange,
  layerOfflineSync,
  onLayerOfflineSyncChange,
  isProjectPanelOpen,
  onProjectPanelChange,
  isLandmarkPanelOpen,
  onLandmarkPanelChange,
}) => {
  const history = useHistory();
  const location = useLocation();
  const {
    controller,
    projects,
    syncStatus,
    tilePrefetchJobs,
    lastSyncedAt,
    isTileCacheOverLimit,
    isTileCacheOverLimitApproved,
    isOfflineLocked,
  } = useSpeleoDB();

  const [cacheBytes, setCacheBytes] = useState(0);
  const [manualTileCount, setManualTileCount] = useState(0);
  const [showLogoutConfirmModal, setShowLogoutConfirmModal] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [showReconnectFailedModal, setShowReconnectFailedModal] = useState(false);

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

  const handleToggleLayerSync = useCallback(
    (layerId: string, enabled: boolean) => {
      onLayerOfflineSyncChange({ ...layerOfflineSync, [layerId]: enabled });
      void controller.setLayerOfflineSync(layerId, enabled);
      Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    },
    [controller, layerOfflineSync, onLayerOfflineSyncChange],
  );

  const handleSelectColorMode = useCallback(
    (value: string) => {
      const nextMode: MapColorMode = isMapColorMode(value) ? value : DEFAULT_MAP_COLOR_MODE;
      persistColorMode(nextMode);
      onColorModeChange(nextMode);
      Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    },
    [onColorModeChange],
  );

  const handleSelectMeasurementUnit = useCallback(
    (value: string) => {
      const nextUnit: MeasurementUnit = isMeasurementUnit(value) ? value : DEFAULT_MEASUREMENT_UNIT;
      persistMeasurementUnit(nextUnit);
      onMeasurementUnitChange(nextUnit);
      Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    },
    [onMeasurementUnitChange],
  );

  const handleShowTutorial = useCallback(() => {
    onProjectPanelChange(false);
    history.push('/dashboard');
    void restartGuidedTourFromHelp();
  }, [history, onProjectPanelChange]);

  const handleGoOnline = useCallback(async () => {
    if (isReconnecting) return;
    setIsReconnecting(true);
    try {
      const result = await controller.attemptReconnect();
      if (result === 'unauthorized') {
        history.replace('/login');
        return;
      }
      if (result === 'network_error') {
        setShowReconnectFailedModal(true);
        return;
      }
      // 'ok': offline lock cleared and a sync launched by the controller; the
      // Go Online section unmounts because isOfflineLocked is now false.
    } catch {
      // Treat unexpected failures like a failed reconnect: nothing changes.
      setShowReconnectFailedModal(true);
    } finally {
      setIsReconnecting(false);
    }
  }, [controller, history, isReconnecting]);

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

  const {
    syncPct,
    syncProcessedTiles,
    syncTotalTiles,
  } = useMemo(() => {
    let prefetchTotal = 0;
    let prefetchDone = 0;
    for (const job of tilePrefetchJobs) {
      prefetchTotal += job.totalTiles;
      prefetchDone += job.completedTiles + job.failedTiles;
    }

    const totalTiles = prefetchTotal + manualTileCount;
    const processedTiles = prefetchDone + manualTileCount;
    return {
      syncTotalTiles: totalTiles,
      syncProcessedTiles: processedTiles,
      syncPct: totalTiles > 0 ? Math.floor((processedTiles / totalTiles) * 100) : 0,
    };
  }, [manualTileCount, tilePrefetchJobs]);

  // Per-layer sync percentage from prefetch jobs (pinned tiles), grouped by
  // layer. Runtime-cached (manual) tiles are excluded here since they cannot be
  // reliably attributed to a single layer.
  const layerSyncPctById = useMemo(() => {
    const totals = new Map<string, { total: number; processed: number }>();
    for (const job of tilePrefetchJobs) {
      const entry = totals.get(job.layerId) ?? { total: 0, processed: 0 };
      entry.total += job.totalTiles;
      entry.processed += job.completedTiles + job.failedTiles;
      totals.set(job.layerId, entry);
    }
    const result: Record<string, number> = {};
    for (const [layerId, { total, processed }] of totals) {
      result[layerId] = total > 0 ? Math.floor((processed / total) * 100) : 0;
    }
    return result;
  }, [tilePrefetchJobs]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Settings</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="settings-content">
        {/* Synchronization Status */}
        <IonList inset>
          <IonListHeader>
            <IonLabel>Synchronization</IonLabel>
            <button
              type="button"
              onClick={handleSync}
              disabled={isOfflineLocked || syncStatus === 'syncing'}
              data-testid="sync-button"
              className="app-btn app-btn--compact ml-auto mr-2 gap-2 bg-emerald-600/90 text-white
                         hover:bg-emerald-500/90 active:bg-emerald-600 touch-manipulation
                         disabled:opacity-60 disabled:cursor-default"
              aria-label={syncStatus === 'syncing' ? 'Syncing in progress' : 'Resync projects'}
            >
              {syncStatus === 'syncing' ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
                  <span data-testid="sync-status-label">{'Syncing\u2026'}</span>
                </>
              ) : (
                <>
                  <IonIcon icon={syncOutline} className="text-lg" />
                  <span>Resync</span>
                </>
              )}
            </button>
          </IonListHeader>

          <IonItem>
            <IonLabel>Last sync</IonLabel>
            <span slot="end" className="text-sm text-slate-400" data-testid="last-sync">
              {formatLastSync(lastSyncedAt)}
            </span>
          </IonItem>

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

          {isTileCacheOverLimitApproved && (
            <IonItem data-testid="storage-approved-status">
              <IonLabel className="ion-text-wrap">
                <p className="text-sm text-slate-200">Extra storage allowed</p>
                <p className="text-xs text-slate-400">
                  Offline maps may exceed the {TILE_CACHE_CAP_MB} MB limit.
                </p>
              </IonLabel>
              <button
                slot="end"
                data-testid="storage-revoke"
                onClick={() => controller.revokeTileCacheOverLimit()}
                className="text-sm text-cyan-300 hover:text-cyan-200 transition-colors"
              >
                Revoke
              </button>
            </IonItem>
          )}
        </IonList>

        {/* Storage over-limit warning */}
        {isTileCacheOverLimit && (
          <IonList inset>
            <IonItem
              button
              detail={false}
              onClick={() => controller.requestStorageConsentPrompt()}
              className="ion-text-center"
              data-testid="storage-over-limit-warning"
            >
              <IonLabel color="warning" className="ion-text-center">
                <IonIcon icon={warningOutline} className="align-middle mr-2 text-base" />
                Storage limit reached
              </IonLabel>
            </IonItem>
          </IonList>
        )}

        {/* Map Settings */}
        <IonList inset>
          <IonListHeader>
            <IonLabel>Map Settings</IonLabel>
          </IonListHeader>

          <IonItem data-tour="settings-show-landmarks">
            <IonToggle
              checked={showLandmarks}
              onIonChange={(e) => handleToggleLandmarks(e.detail.checked)}
              data-testid="landmark-toggle"
            >
              Show landmarks
            </IonToggle>
          </IonItem>
          <IonItem data-tour="settings-color-mode">
            <IonLabel>Color mode</IonLabel>
            <div slot="end" className="relative">
              <select
                value={colorMode}
                onChange={(e) => handleSelectColorMode(e.target.value)}
                data-testid="color-mode-selector"
                aria-label="Color mode"
                className={MAP_SELECT_CLASS}
              >
                <option value="project">By Project</option>
                <option value="depth">By Depth</option>
              </select>
              <IonIcon
                icon={chevronDownOutline}
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm"
                aria-hidden="true"
              />
            </div>
          </IonItem>
          <IonItem data-tour="settings-measurement-unit">
            <IonLabel>Map unit</IonLabel>
            <div slot="end" className="relative">
              <select
                value={measurementUnit}
                onChange={(e) => handleSelectMeasurementUnit(e.target.value)}
                data-testid="measurement-unit-selector"
                aria-label="Map unit"
                className={MAP_SELECT_CLASS}
              >
                <option value="meters">Meters</option>
                <option value="feet">Feet</option>
              </select>
              <IonIcon
                icon={chevronDownOutline}
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm"
                aria-hidden="true"
              />
            </div>
          </IonItem>
        </IonList>

        {/* Map Layers */}
        <IonList inset>
          <IonListHeader>
            <IonLabel>Map Layers (offline sync)</IonLabel>
          </IonListHeader>

          {MAP_LAYERS.map((layer) => {
            const isEnabled = layer.forcedOffline || layerOfflineSync[layer.id] === true;
            const pct = layerSyncPctById[layer.id] ?? 0;
            // Toggling an extra layer requires network (enabling schedules a
            // prefetch; both states reconcile cached tiles), so lock it while
            // offline. The forced satellite layer is always disabled anyway.
            const toggleDisabled = layer.forcedOffline || isOfflineLocked;
            const statusText = isEnabled
              ? `Offline sync ${pct}%${layer.forcedOffline ? ' (always on)' : ''}`
              : isOfflineLocked
                ? 'Offline sync off (unavailable offline)'
                : 'Offline sync off';
            return (
              <IonItem key={layer.id} data-testid={`layer-row-${layer.id}`}>
                <IonLabel className="ion-text-wrap">
                  <span className="block text-sm font-medium text-white">{layer.label}</span>
                  <span
                    className="block text-[11px] text-slate-400 mt-0.5"
                    data-testid={`layer-sync-status-${layer.id}`}
                  >
                    {statusText}
                  </span>
                </IonLabel>
                <IonToggle
                  slot="end"
                  checked={isEnabled}
                  disabled={toggleDisabled}
                  onIonChange={(e) => handleToggleLayerSync(layer.id, e.detail.checked)}
                  data-testid={`layer-toggle-${layer.id}`}
                  aria-label={`Offline sync ${layer.label}`}
                />
              </IonItem>
            );
          })}
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

        {/* Go Online (only while offline-locked) */}
        {isOfflineLocked && (
          <IonList inset>
            <IonItem
              button
              detail={false}
              disabled={isReconnecting}
              onClick={handleGoOnline}
              className="ion-text-center"
              data-testid="go-online-button"
            >
              <IonLabel color="warning" className="ion-text-center">
                {isReconnecting ? 'Reconnecting\u2026' : 'Go Online'}
              </IonLabel>
            </IonItem>
          </IonList>
        )}

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
                  className="app-btn bg-slate-800/70 text-slate-200 hover:bg-slate-700/70 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isLoggingOut}
                  onClick={handleConfirmLogout}
                  className="app-btn bg-red-600 text-white hover:bg-red-500 disabled:opacity-50"
                >
                  {isLoggingOut ? 'Clearing data\u2026' : 'Wipe local data & Sign Out'}
                </button>
              </div>
            </div>
          </IonContent>
        </IonModal>

        {/* Reconnect failed modal */}
        <IonModal
          isOpen={showReconnectFailedModal}
          onDidDismiss={() => setShowReconnectFailedModal(false)}
          data-testid="reconnect-failed-modal"
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
                      d="M18.364 5.636a9 9 0 010 12.728m-12.728 0a9 9 0 010-12.728m9.9 2.829a5 5 0 010 7.07m-7.072 0a5 5 0 010-7.07M12 12h.01"
                    />
                  </svg>
                </span>
                <h2 className="text-xl font-semibold text-slate-100 mb-2">Couldn&apos;t reconnect</h2>
                <p className="text-slate-300 text-sm mb-2">
                  We could not reach the SpeleoDB server. You are still in offline mode.
                </p>
                <p className="text-slate-400 text-sm">
                  Check your connection and try again, or keep working with your cached data.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <button
                  type="button"
                  onClick={() => setShowReconnectFailedModal(false)}
                  data-testid="reconnect-failed-dismiss"
                  className="app-btn bg-slate-700/60 text-slate-100 border border-slate-600/50
                             hover:bg-slate-600/70 hover:text-white active:bg-slate-700 touch-manipulation"
                >
                  OK
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
          isLandmarkPanelOpen={isLandmarkPanelOpen}
          onLandmarkPanelChange={onLandmarkPanelChange}
        />
      </IonFooter>
    </IonPage>
  );
};

export default Settings;
