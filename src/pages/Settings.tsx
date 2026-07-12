import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useHistory } from 'react-router-dom';
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

import { useOfflineMapSync, useSpeleoDB } from '../context/useSpeleoDB';
import { MAP, MAP_LAYERS } from '../constants';
import AppTabBar from '../components/AppTabBar';
import ReconnectFailedModal from '../components/ReconnectFailedModal';
import {
  setColorMode as persistColorMode,
  setMeasurementUnit as persistMeasurementUnit,
  setShowLandmarks as persistShowLandmarks,
} from '../services/PreferencesService';
import { restartGuidedTourFromHelp } from '../onboarding/guidedTour/runtime';
import { isMapColorMode, DEFAULT_MAP_COLOR_MODE, type MapColorMode } from '../types/mapColorMode';
import { isMeasurementUnit, DEFAULT_MEASUREMENT_UNIT, type MeasurementUnit } from '../types/measurementUnit';
import type { DashboardPanel, DashboardPanelChange } from '../types/dashboardPanel';
import { formatLastSync } from '../utils/formatLastSync';
import { useOfflineReconnect } from '../hooks/useOfflineReconnect';

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

function formatEta(etaSeconds: number | null): string | null {
  if (etaSeconds === null || !Number.isFinite(etaSeconds) || etaSeconds <= 0) return null;
  const totalSeconds = Math.ceil(etaSeconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}m` : ''} left`;
  if (minutes > 0) return `${minutes}m left`;
  return `${totalSeconds}s left`;
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
  activeDashboardPanel: DashboardPanel;
  onDashboardPanelChange: DashboardPanelChange;
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
  activeDashboardPanel,
  onDashboardPanelChange,
}) => {
  const history = useHistory();
  const {
    controller,
    projects,
    syncStatus,
    lastSyncedAt,
    isTileCacheOverLimit,
    isTileCacheOverLimitApproved,
    isOfflineLocked,
    pendingOpsCount,
    gpsRecordingState,
  } = useSpeleoDB();
  const offlineMapSync = useOfflineMapSync();

  const [showLogoutConfirmModal, setShowLogoutConfirmModal] = useState(false);
  const [showRefreshConfirmModal, setShowRefreshConfirmModal] = useState(false);
  const [isRefreshingOfflineMaps, setIsRefreshingOfflineMaps] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [acknowledgedPendingOpsCount, setAcknowledgedPendingOpsCount] = useState<number | null>(null);
  const hasPendingOfflineOps = pendingOpsCount > 0;
  const hasAcknowledgedPendingOpsLoss = hasPendingOfflineOps
    && acknowledgedPendingOpsCount === pendingOpsCount;
  const {
    isReconnecting,
    showReconnectFailedModal,
    setShowReconnectFailedModal,
    attemptReconnect,
  } = useOfflineReconnect();

  useEffect(() => {
    if (!controller.isAuthenticated()) {
      history.push('/login');
    }
  }, [history, controller]);

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
  }, [controller]);

  const handleConfirmRefreshOfflineMaps = useCallback(async () => {
    if (isRefreshingOfflineMaps || isOfflineLocked) return;
    setIsRefreshingOfflineMaps(true);
    setShowRefreshConfirmModal(false);
    try {
      await controller.refreshOfflineMaps();
    } finally {
      setIsRefreshingOfflineMaps(false);
    }
  }, [controller, isOfflineLocked, isRefreshingOfflineMaps]);

  const handleToggleLayerSync = useCallback(
    async (layerId: string, enabled: boolean) => {
      try {
        await controller.setLayerOfflineSync(layerId, enabled);
        onLayerOfflineSyncChange({ ...layerOfflineSync, [layerId]: enabled });
        Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
      } catch {
        // Keep the controlled toggle at its previous value when release/eviction fails.
      }
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
    onDashboardPanelChange(null);
    history.push('/dashboard');
    void restartGuidedTourFromHelp();
  }, [history, onDashboardPanelChange]);

  const handleLogout = useCallback(() => {
    setAcknowledgedPendingOpsCount(null);
    setShowLogoutConfirmModal(true);
  }, []);

  const handleDismissLogout = useCallback(() => {
    setShowLogoutConfirmModal(false);
    setAcknowledgedPendingOpsCount(null);
  }, []);

  const handleConfirmLogout = useCallback(async () => {
    if (isLoggingOut || (hasPendingOfflineOps && !hasAcknowledgedPendingOpsLoss)) return;
    setIsLoggingOut(true);
    try {
      await controller.logout();
      setShowLogoutConfirmModal(false);
      setAcknowledgedPendingOpsCount(null);
      history.replace('/login');
    } catch {
      // Logout failed; keep modal open so user can retry or cancel.
    } finally {
      setIsLoggingOut(false);
    }
  }, [
    controller,
    hasAcknowledgedPendingOpsLoss,
    hasPendingOfflineOps,
    history,
    isLoggingOut,
  ]);

  const geoJsonProjectCount = useMemo(
    () => projects.filter((p) => !p.exclude_geojson && Boolean(p.geojson_file)).length,
    [projects],
  );

  const enabledLayerIds = useMemo(() => new Set(
    MAP_LAYERS
      .filter((layer) => layer.forcedOffline || layerOfflineSync[layer.id] === true)
      .map((layer) => layer.id),
  ), [layerOfflineSync]);

  const {
    syncPct,
    syncProcessedTiles,
    syncTotalTiles,
    layerSyncPctById,
    layerProgressById,
    layerDisplayCompletedById,
  } = useMemo(() => {
    const operationHasLockedTotal = offlineMapSync.coordinateCount !== null;
    const totalTiles = operationHasLockedTotal
      ? offlineMapSync.totalTiles
      : offlineMapSync.coverageTotalTiles;
    const progressById = Object.fromEntries(
      offlineMapSync.layers.map((layer) => [layer.layerId, layer] as const),
    );
    const percentages: Record<string, number> = {};
    const displayCompletedById: Record<string, number> = {};
    for (const layerId of enabledLayerIds) {
      const layer = progressById[layerId];
      const total = layer?.totalTiles ?? offlineMapSync.coordinateCount ?? 0;
      const rawCompleted = operationHasLockedTotal
        ? layer?.completedTiles ?? 0
        : layer?.usableTiles ?? 0;
      const completed = Math.min(total, Math.max(0, rawCompleted));
      displayCompletedById[layerId] = completed;
      percentages[layerId] = total > 0
        ? Math.min(100, Math.floor((completed / total) * 100))
        : 0;
    }
    const completedTiles = operationHasLockedTotal && offlineMapSync.layers.length > 0
      ? offlineMapSync.layers.reduce(
        (sum, layer) => sum + Math.min(layer.totalTiles, Math.max(0, layer.completedTiles)),
        0,
      )
      : operationHasLockedTotal
        ? Math.min(totalTiles, Math.max(0, offlineMapSync.completedTiles))
        : Math.min(totalTiles, Math.max(0, offlineMapSync.coverageCompletedTiles));

    return {
      syncTotalTiles: totalTiles,
      syncProcessedTiles: completedTiles,
      syncPct: totalTiles > 0 ? Math.floor((completedTiles / totalTiles) * 100) : 0,
      layerSyncPctById: percentages,
      layerProgressById: progressById,
      layerDisplayCompletedById: displayCompletedById,
    };
  }, [enabledLayerIds, offlineMapSync]);
  const etaLabel = formatEta(offlineMapSync.etaSeconds);

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
              className="app-btn app-btn--compact app-btn--success ml-auto mr-2 gap-2
                         touch-manipulation"
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
              {formatBytes(offlineMapSync.cacheBytes)}
            </span>
          </IonItem>

          <IonItem>
            <IonLabel>
              {offlineMapSync.phase === 'planning' ? 'Preparing offline maps' : 'Sync progress'}
            </IonLabel>
            <span slot="end" className="text-sm text-slate-400" data-testid="sync-pct">
              {offlineMapSync.phase === 'planning' ? 'Preparing…' : `${syncPct}%`}
            </span>
          </IonItem>

          <IonItem>
            <IonLabel>Tiles synced</IonLabel>
            <span slot="end" className="text-sm text-slate-400" data-testid="sync-tiles">
              {offlineMapSync.phase === 'planning' && syncTotalTiles === 0
                ? 'Preparing…'
                : `${formatNumber(syncProcessedTiles)} / ${formatNumber(syncTotalTiles)}`}
            </span>
          </IonItem>

          {offlineMapSync.failedTiles > 0 && (
            <IonItem>
              <IonLabel>Failed tiles</IonLabel>
              <span slot="end" className="text-sm text-amber-300" data-testid="failed-tiles">
                {formatNumber(offlineMapSync.failedTiles)}
              </span>
            </IonItem>
          )}

          {(offlineMapSync.phase === 'auditing' || offlineMapSync.phase === 'downloading') && (
            <IonItem>
              <IonLabel>Download speed</IonLabel>
              <span slot="end" className="text-sm text-slate-400" data-testid="offline-map-speed">
                {offlineMapSync.tilesPerSecond.toFixed(1)} tiles/s
                {etaLabel !== null ? ` · ${etaLabel}` : ''}
              </span>
            </IonItem>
          )}

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
            const progress = layerProgressById[layer.id];
            // Toggling an extra layer requires network (enabling schedules a
            // prefetch; both states reconcile cached tiles), so lock it while
            // offline. The forced satellite layer is always disabled anyway.
            const toggleDisabled = layer.forcedOffline || isOfflineLocked;
            const progressCount = progress
              ? ` · ${formatNumber(layerDisplayCompletedById[layer.id] ?? 0)} / ${formatNumber(progress.totalTiles)}`
              : '';
            const failureCount = progress && progress.failedTiles > 0
              ? ` · ${formatNumber(progress.failedTiles)} failed`
              : '';
            const statusText = isEnabled
              ? `Offline sync ${pct}%${progressCount}${failureCount}${layer.forcedOffline ? ' (always on)' : ''}`
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
                  onIonChange={(e) => void handleToggleLayerSync(layer.id, e.detail.checked)}
                  data-testid={`layer-toggle-${layer.id}`}
                  aria-label={`Offline sync ${layer.label}`}
                />
              </IonItem>
            );
          })}

          <div className="px-4 py-3">
            <button
              type="button"
              onClick={() => setShowRefreshConfirmModal(true)}
              disabled={
                isOfflineLocked
                || isRefreshingOfflineMaps
                || controller.isOfflineMapRefreshActive
              }
              data-testid="refresh-offline-maps-button"
              className="app-btn app-btn--compact app-btn--info w-full justify-center gap-2"
            >
              <IonIcon
                icon={syncOutline}
                className={
                  isRefreshingOfflineMaps || controller.isOfflineMapRefreshActive
                    ? 'animate-spin'
                    : ''
                }
                aria-hidden="true"
              />
              {isRefreshingOfflineMaps || controller.isOfflineMapRefreshActive
                ? 'Refreshing offline maps…'
                : 'Refresh offline maps'}
            </button>
          </div>
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
              onClick={attemptReconnect}
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
          isOpen={showRefreshConfirmModal}
          onDidDismiss={() => setShowRefreshConfirmModal(false)}
        >
          <IonContent className="ion-padding">
            <div className="flex flex-col h-full justify-center max-w-sm mx-auto text-center">
              <h2 className="text-xl font-semibold text-slate-100 mb-3">
                Refresh offline maps?
              </h2>
              <p className="text-slate-300 text-sm mb-6">
                Satellite imagery and enabled offline layers will be downloaded again.
                Existing tiles remain available until each replacement is safely stored.
              </p>
              <div className="grid grid-cols-1 gap-3">
                <button
                  type="button"
                  onClick={() => setShowRefreshConfirmModal(false)}
                  className="app-btn app-btn--secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmRefreshOfflineMaps()}
                  className="app-btn app-btn--info"
                  data-testid="confirm-refresh-offline-maps"
                >
                  Refresh now
                </button>
              </div>
            </div>
          </IonContent>
        </IonModal>

        <IonModal
          isOpen={showLogoutConfirmModal}
          onDidDismiss={handleDismissLogout}
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
                <h2 className="text-xl font-semibold text-slate-100 mb-2">
                  {hasPendingOfflineOps
                    ? 'Pending offline operations will be lost'
                    : 'Clear local data and sign out?'}
                </h2>
                {!hasPendingOfflineOps && (
                  <>
                    <p className="text-slate-300 text-sm mb-2">
                      All local data will be cleared immediately from this device.
                    </p>
                    <p className="text-slate-400 text-sm">
                      This includes cached maps, GeoJSON, projects, and offline credentials. You will not be able to reconnect without network access.
                    </p>
                  </>
                )}
                {hasPendingOfflineOps && (
                  <div
                    className="mt-5 rounded-lg border border-red-400/70 bg-red-950/60 p-4 text-left"
                    data-testid="pending-ops-loss-warning"
                  >
                    <p className="text-sm text-red-100 mb-3" id="pending-ops-loss-description">
                      You have {pendingOpsCount} pending offline operation{pendingOpsCount === 1 ? '' : 's'}.
                      {' '}Signing out will permanently delete all pending offline operations from this device.
                      {' '}They cannot be recovered or synchronized later.
                    </p>
                    <label className="flex items-start gap-3 text-sm text-red-100">
                      <input
                        type="checkbox"
                        checked={hasAcknowledgedPendingOpsLoss}
                        disabled={isLoggingOut}
                        onChange={(event) => setAcknowledgedPendingOpsCount(
                          event.target.checked ? pendingOpsCount : null,
                        )}
                        aria-describedby="pending-ops-loss-description"
                        className="mt-1 h-4 w-4 accent-red-500"
                        data-testid="pending-ops-loss-acknowledgement"
                      />
                      <span>
                        I understand that these pending offline operations will be permanently deleted and are unrecoverable.
                      </span>
                    </label>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3">
                <button
                  type="button"
                  disabled={isLoggingOut}
                  onClick={handleDismissLogout}
                  className="app-btn app-btn--secondary"
                  data-testid="cancel-logout"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    isLoggingOut
                    || (hasPendingOfflineOps && !hasAcknowledgedPendingOpsLoss)
                  }
                  onClick={handleConfirmLogout}
                  className="app-btn app-btn--danger"
                  data-testid="confirm-logout"
                >
                  {isLoggingOut
                    ? 'Clearing data\u2026'
                    : hasPendingOfflineOps
                      ? 'Delete Offline Operations & Sign Out'
                      : 'Wipe local data & Sign Out'}
                </button>
              </div>
            </div>
          </IonContent>
        </IonModal>

        <ReconnectFailedModal
          isOpen={showReconnectFailedModal}
          onDismiss={() => setShowReconnectFailedModal(false)}
        />
      </IonContent>
      <IonFooter className="ion-no-border">
        <AppTabBar
          activeDashboardPanel={activeDashboardPanel}
          onDashboardPanelChange={onDashboardPanelChange}
          isGpsRecording={gpsRecordingState !== 'idle'}
          pendingOpsCount={pendingOpsCount}
        />
      </IonFooter>
    </IonPage>
  );
};

export default Settings;
