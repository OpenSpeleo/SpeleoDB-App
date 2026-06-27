import React from 'react';
import { IonContent, IonModal } from '@ionic/react';

import type { OfflineOpConflict } from '../types/offlineOp';

interface OfflineOpConflictModalProps {
  conflict: OfflineOpConflict | null;
  busy?: boolean;
  onKeepLocal: () => void;
  onUseServer: () => void;
  onCancel: () => void;
}

/**
 * Plain-language conflict resolver shown when a queued edit/delete cannot be
 * applied because the landmark changed on the server since the user acted.
 *
 * Deliberately non-technical: a short explanation, a two-column "Your change"
 * vs "On the server" diff (only the fields that differ), and two large choices.
 * No jargon, no raw ids.
 */
const OfflineOpConflictModal: React.FC<OfflineOpConflictModalProps> = ({
  conflict,
  busy = false,
  onKeepLocal,
  onUseServer,
  onCancel,
}) => {
  const isDelete = conflict?.kind === 'delete';
  const serverGone = conflict ? conflict.server === null : false;
  const noun = conflict?.entityLabel || 'landmark';

  return (
    <IonModal
      isOpen={conflict !== null}
      onDidDismiss={() => {
        if (!busy) onCancel();
      }}
      canDismiss={!busy}
      backdropDismiss={!busy}
      data-testid="offline-conflict-modal"
    >
      <IonContent className="ion-padding">
        <div className="flex flex-col h-full max-w-md mx-auto">
          <div className="text-center mb-5 mt-2">
            <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-500/20 text-amber-400 mb-4">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
            </span>
            <h2 className="text-xl font-semibold text-slate-100 mb-1">
              This {noun} changed
            </h2>
            <p className="text-sm text-slate-300">
              {conflict?.title ? `"${conflict.title}" ` : `This ${noun} `}
              was {serverGone ? 'removed' : 'changed'} on the server while you were offline.
              {isDelete
                ? ' You chose to delete it. Which version do you want to keep?'
                : ' Choose which version to keep.'}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {serverGone ? (
              <div
                className="rounded-xl border border-slate-600/60 bg-slate-800/60 p-4 text-sm text-slate-300"
                data-testid="conflict-server-gone"
              >
                The {noun} no longer exists on the server. Keeping your change will
                {isDelete ? ' confirm the deletion' : ' re-create it'}; using the server
                version will discard your offline change.
              </div>
            ) : (
              <div className="rounded-xl border border-slate-600/60 overflow-hidden">
                <div className="grid grid-cols-3 bg-slate-800/80 text-[11px] uppercase tracking-wide text-slate-400">
                  <div className="px-3 py-2">Field</div>
                  <div className="px-3 py-2 text-purple-300">Your change</div>
                  <div className="px-3 py-2 text-cyan-300">On the server</div>
                </div>
                {conflict?.rows.length ? (
                  conflict.rows.map((row) => (
                    <div
                      key={row.field}
                      className="grid grid-cols-3 border-t border-slate-700/50 text-sm"
                      data-testid={`conflict-row-${row.field}`}
                    >
                      <div className="px-3 py-2 text-slate-400">{row.label}</div>
                      <div className="px-3 py-2 text-slate-100 break-words">
                        {isDelete ? '\u2014' : row.local}
                      </div>
                      <div className="px-3 py-2 text-slate-100 break-words">{row.server}</div>
                    </div>
                  ))
                ) : (
                  <div className="px-3 py-3 text-sm text-slate-400 border-t border-slate-700/50">
                    The differences are not shown in detail, but the server copy differs
                    from yours.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 mt-5">
            <button
              type="button"
              disabled={busy}
              onClick={onKeepLocal}
              data-testid="conflict-keep-local"
              className={`app-btn ${isDelete ? 'app-btn--danger' : 'app-btn--primary'} w-full touch-manipulation`}
            >
              {isDelete ? 'Delete it anyway' : 'Keep my change'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onUseServer}
              data-testid="conflict-use-server"
              className="app-btn app-btn--info w-full touch-manipulation"
            >
              Use server version
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              data-testid="conflict-cancel"
              className="app-btn app-btn--secondary w-full touch-manipulation"
            >
              Decide later
            </button>
          </div>
        </div>
      </IonContent>
    </IonModal>
  );
};

export default OfflineOpConflictModal;
