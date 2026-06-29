import React, { useCallback, useMemo, useState } from 'react';
import { useHistory } from 'react-router-dom';
import {
  IonContent,
  IonFooter,
  IonHeader,
  IonPage,
  IonTitle,
  IonToast,
  IonToolbar,
} from '@ionic/react';

import { useSpeleoDB } from '../context/useSpeleoDB';
import AppTabBar from '../components/AppTabBar';
import OfflineOpConflictModal from '../components/OfflineOpConflictModal';
import ReconnectFailedModal from '../components/ReconnectFailedModal';
import type {
  OfflineConflictChoice,
  OfflineOpConflict,
  OfflineOpView,
} from '../types/offlineOp';
import type { OfflineSyncSummary } from '../offline/OfflineOpQueue';
import type { DashboardPanel, DashboardPanelChange } from '../types/dashboardPanel';
import { formatLastSync } from '../utils/formatLastSync';
import { useOfflineReconnect } from '../hooks/useOfflineReconnect';

interface PendingOpsProps {
  activeDashboardPanel: DashboardPanel;
  onDashboardPanelChange: DashboardPanelChange;
}

const KIND_LABEL: Record<OfflineOpView['kind'], string> = {
  create: 'Create',
  update: 'Edit',
  delete: 'Delete',
};

function kindAccent(kind: OfflineOpView['kind']): string {
  switch (kind) {
    case 'create':
      return 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30';
    case 'update':
      return 'bg-sky-500/15 text-sky-300 border border-sky-500/30';
    case 'delete':
      return 'bg-red-500/15 text-red-300 border border-red-500/30';
  }
}

const PendingOps: React.FC<PendingOpsProps> = ({
  activeDashboardPanel,
  onDashboardPanelChange,
}) => {
  const history = useHistory();
  const { controller, pendingOpsCount, pendingOpsRevision, isOfflineLocked, gpsRecordingState } =
    useSpeleoDB();

  // Re-read the list whenever the queue changes (revision bumps on any mutation).
  const ops = useMemo<OfflineOpView[]>(
    () => controller.getPendingOps(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, pendingOpsRevision],
  );

  const [busy, setBusy] = useState(false);
  const [busyOpId, setBusyOpId] = useState<string | null>(null);
  const [conflictOpId, setConflictOpId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const {
    isReconnecting,
    showReconnectFailedModal,
    setShowReconnectFailedModal,
    attemptReconnect,
  } = useOfflineReconnect();

  const conflict = useMemo<OfflineOpConflict | null>(() => {
    if (!conflictOpId) return null;
    const match = ops.find((op) => op.id === conflictOpId && op.conflict);
    return match?.conflict ?? null;
  }, [conflictOpId, ops]);

  const showToast = useCallback((message: string, tone: 'success' | 'error') => {
    setToast({ message, tone });
  }, []);

  const handleSummary = useCallback(
    (summary: OfflineSyncSummary) => {
      if (summary.reason === 'offline') {
        showToast('You are offline. Try reconnecting to sync.', 'error');
        return;
      }
      if (summary.reason === 'pull_failed') {
        showToast('Could not reach the server. Try again.', 'error');
        return;
      }
      if (summary.conflictIds.length > 0) {
        setConflictOpId(summary.conflictIds[0]);
        showToast(
          `${summary.conflictIds.length} item${summary.conflictIds.length > 1 ? 's' : ''} need your attention`,
          'error',
        );
        return;
      }
      if (summary.failed > 0) {
        showToast('Some items could not be synced.', 'error');
        return;
      }
      if (summary.succeeded > 0) {
        showToast('Synced', 'success');
      }
    },
    [showToast],
  );

  const handleSyncAll = useCallback(() => {
    if (busy || isOfflineLocked) return;
    setBusy(true);
    void (async () => {
      try {
        handleSummary(await controller.syncOfflineOps());
      } finally {
        setBusy(false);
      }
    })();
  }, [busy, isOfflineLocked, controller, handleSummary]);

  const handleSyncOne = useCallback(
    (id: string) => {
      if (busy || busyOpId || isOfflineLocked) return;
      setBusyOpId(id);
      void (async () => {
        try {
          handleSummary(await controller.syncOfflineOp(id));
        } finally {
          setBusyOpId(null);
        }
      })();
    },
    [busy, busyOpId, isOfflineLocked, controller, handleSummary],
  );

  const handleDiscard = useCallback(
    (id: string) => {
      if (busy || busyOpId) return;
      setBusyOpId(id);
      void (async () => {
        try {
          await controller.discardOfflineOp(id);
          showToast('Pending change removed', 'success');
        } finally {
          setBusyOpId(null);
        }
      })();
    },
    [busy, busyOpId, controller, showToast],
  );

  const handleResolve = useCallback(
    (choice: OfflineConflictChoice) => {
      const id = conflictOpId;
      if (!id || resolving) return;
      setResolving(true);
      void (async () => {
        try {
          const summary = await controller.resolveOfflineOpConflict(id, choice);
          if (summary.reason === 'offline' || summary.reason === 'pull_failed') {
            showToast('Could not reach the server. Try again.', 'error');
            return;
          }
          if (summary.failed > 0) {
            showToast('This change could not be resolved. Check the item for details.', 'error');
            return;
          }
          setConflictOpId(null);
          showToast(choice === 'local' ? 'Your change was kept' : 'Server version kept', 'success');
        } finally {
          setResolving(false);
        }
      })();
    },
    [conflictOpId, resolving, controller, showToast],
  );

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Pending Changes</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        <div className="max-w-xl mx-auto">
          {isOfflineLocked && (
            <div
              className="rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm px-4 py-3 mb-4"
              data-testid="pending-offline-hint"
            >
              You are offline. Your changes are saved on this device. Try reconnecting
              here when your connection is back, then sync your pending changes.
            </div>
          )}

          {pendingOpsCount === 0 ? (
            <div className="text-center text-slate-400 mt-16" data-testid="pending-empty">
              <p className="text-base font-medium text-slate-200 mb-1">All caught up</p>
              <p className="text-sm">There are no pending changes to sync.</p>
              <button
                type="button"
                onClick={() => history.push('/dashboard')}
                className="app-btn app-btn--secondary mt-6 mx-auto"
              >
                Back to map
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 mb-4">
                <p className="text-sm text-slate-400" data-testid="pending-count">
                  {pendingOpsCount} pending change{pendingOpsCount > 1 ? 's' : ''}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSyncAll}
                    disabled={busy || isOfflineLocked}
                    data-testid="sync-now-button"
                    className="app-btn app-btn--primary app-btn--compact gap-2 touch-manipulation"
                  >
                    {busy ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
                        <span>Syncing&hellip;</span>
                      </>
                    ) : (
                      <span>Sync Now</span>
                    )}
                  </button>
                  {isOfflineLocked && (
                    <button
                      type="button"
                      onClick={attemptReconnect}
                      disabled={isReconnecting}
                      data-testid="pending-try-reconnect-button"
                      className="app-btn app-btn--info app-btn--compact touch-manipulation"
                    >
                      {isReconnecting ? 'Reconnecting\u2026' : 'Try Reconnect'}
                    </button>
                  )}
                </div>
              </div>

              <ul className="flex flex-col gap-3" data-testid="pending-list">
                {ops.map((op) => {
                  const rowBusy = busyOpId === op.id;
                  return (
                    <li
                      key={op.id}
                      data-testid={`pending-op-${op.id}`}
                      className="rounded-xl border border-slate-700/60 bg-slate-800/50 p-4"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${kindAccent(op.kind)}`}
                        >
                          {KIND_LABEL[op.kind]}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-100 truncate">{op.title}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{op.summary}</p>
                          <p className="text-[11px] text-slate-500 mt-1">
                            {formatLastSync(op.createdAt)}
                          </p>
                          {op.status === 'conflict' && (
                            <p className="text-xs text-amber-300 mt-1" data-testid={`pending-conflict-${op.id}`}>
                              Needs your attention &mdash; changed on the server.
                            </p>
                          )}
                          {op.status === 'error' && op.lastError && (
                            <p className="text-xs text-red-300 mt-1" data-testid={`pending-error-${op.id}`}>
                              {op.lastError}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 mt-3">
                        {op.status === 'conflict' ? (
                          <button
                            type="button"
                            onClick={() => setConflictOpId(op.id)}
                            disabled={busy || isOfflineLocked}
                            data-testid={`resolve-op-${op.id}`}
                            className="app-btn app-btn--primary app-btn--compact flex-1 touch-manipulation"
                          >
                            Resolve
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSyncOne(op.id)}
                            disabled={busy || rowBusy || isOfflineLocked}
                            data-testid={`sync-op-${op.id}`}
                            className="app-btn app-btn--secondary app-btn--compact flex-1 gap-2 touch-manipulation"
                          >
                            {rowBusy ? (
                              <>
                                <div className="w-3.5 h-3.5 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
                                <span>Syncing&hellip;</span>
                              </>
                            ) : (
                              <span>Sync</span>
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDiscard(op.id)}
                          disabled={busy || rowBusy}
                          data-testid={`discard-op-${op.id}`}
                          className="app-btn app-btn--danger app-btn--compact touch-manipulation"
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </IonContent>

      <OfflineOpConflictModal
        conflict={conflict}
        busy={resolving}
        onKeepLocal={() => handleResolve('local')}
        onUseServer={() => handleResolve('server')}
        onCancel={() => setConflictOpId(null)}
      />

      <ReconnectFailedModal
        isOpen={showReconnectFailedModal}
        onDismiss={() => setShowReconnectFailedModal(false)}
      />

      <IonToast
        isOpen={toast !== null}
        message={toast?.message}
        duration={2600}
        color={toast?.tone === 'error' ? 'danger' : 'success'}
        onDidDismiss={() => setToast(null)}
        data-testid="pending-toast"
      />

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

export default PendingOps;
