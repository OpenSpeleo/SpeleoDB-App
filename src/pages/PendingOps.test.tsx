import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import PendingOps from './PendingOps';
import { SpeleoDBContext, type SpeleoDBContextValue } from '../context/useSpeleoDB';
import type { OfflineOpView } from '../types/offlineOp';
import type { OfflineSyncSummary } from '../offline/OfflineOpQueue';

// Mock Ionic primitives so modals/toasts render inline (no jsdom teleport).
vi.mock('@ionic/react', () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    IonPage: Passthrough,
    IonHeader: Passthrough,
    IonToolbar: Passthrough,
    IonTitle: Passthrough,
    IonContent: Passthrough,
    IonFooter: Passthrough,
    IonModal: ({ children, isOpen }: { children?: React.ReactNode; isOpen?: boolean }) =>
      isOpen ? <div data-testid="ion-modal">{children}</div> : null,
    IonToast: ({ isOpen, message }: { isOpen?: boolean; message?: string }) =>
      isOpen ? <div data-testid="ion-toast">{message}</div> : null,
  };
});

function summary(overrides: Partial<OfflineSyncSummary> = {}): OfflineSyncSummary {
  return {
    reason: 'completed',
    succeeded: 0,
    conflicted: 0,
    failed: 0,
    conflictIds: [],
    remaining: 0,
    ...overrides,
  };
}

interface SetupOptions {
  ops?: OfflineOpView[];
  pendingOpsCount?: number;
  isOfflineLocked?: boolean;
  syncOfflineOps?: ReturnType<typeof vi.fn>;
  syncOfflineOp?: ReturnType<typeof vi.fn>;
  discardOfflineOp?: ReturnType<typeof vi.fn>;
  resolveOfflineOpConflict?: ReturnType<typeof vi.fn>;
  attemptReconnect?: ReturnType<typeof vi.fn>;
}

function setup(options: SetupOptions = {}) {
  const ops = options.ops ?? [];
  const controller = {
    getPendingOps: vi.fn(() => ops),
    syncOfflineOps: options.syncOfflineOps ?? vi.fn(async () => summary({ succeeded: ops.length })),
    syncOfflineOp: options.syncOfflineOp ?? vi.fn(async () => summary({ succeeded: 1 })),
    discardOfflineOp: options.discardOfflineOp ?? vi.fn(async () => {}),
    resolveOfflineOpConflict:
      options.resolveOfflineOpConflict ?? vi.fn(async () => summary({ succeeded: 1 })),
    attemptReconnect: options.attemptReconnect ?? vi.fn(async () => 'ok'),
  };

  const value = {
    controller,
    pendingOpsCount: options.pendingOpsCount ?? ops.length,
    pendingOpsRevision: 1,
    isOfflineLocked: options.isOfflineLocked ?? false,
  } as unknown as SpeleoDBContextValue;

  render(
    <MemoryRouter initialEntries={['/pending']}>
      <SpeleoDBContext.Provider value={value}>
        <PendingOps
          activeDashboardPanel={null}
          onDashboardPanelChange={vi.fn()}
        />
      </SpeleoDBContext.Provider>
    </MemoryRouter>,
  );

  return { controller };
}

const createOp: OfflineOpView = {
  id: 'op-create',
  kind: 'create',
  status: 'pending',
  createdAt: Date.now(),
  title: 'New Camp',
  summary: 'New landmark in Personal Landmarks',
  changes: [],
};

const conflictOp: OfflineOpView = {
  id: 'op-conflict',
  kind: 'update',
  status: 'conflict',
  createdAt: Date.now(),
  title: 'Camp',
  summary: 'Edited name',
  changes: [],
  conflict: {
    kind: 'update',
    title: 'Camp',
    local: { name: 'Mine', description: '', latitude: 1, longitude: 2, collection: null },
    server: { name: 'Theirs', description: '', latitude: 1, longitude: 2, collection: null },
    rows: [{ field: 'name', label: 'Name', local: 'Mine', server: 'Theirs' }],
  },
};

describe('PendingOps', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows the empty state when there is nothing queued', () => {
    setup({ ops: [], pendingOpsCount: 0 });
    expect(screen.getByTestId('pending-empty')).toBeTruthy();
  });

  it('lists pending ops', () => {
    setup({ ops: [createOp] });
    expect(screen.getByTestId('pending-op-op-create')).toHaveTextContent('New Camp');
    expect(screen.getByTestId('pending-count')).toHaveTextContent('1 pending change');
  });

  it('lists a pending GPS-track op alongside landmark ops', () => {
    const gpsOp: OfflineOpView = {
      id: 'op-gps',
      entityType: 'gpsTrack',
      kind: 'create',
      status: 'pending',
      createdAt: Date.now(),
      title: 'Surface Walk',
      summary: 'Upload GPS track',
      changes: [],
    };
    setup({ ops: [gpsOp] });
    expect(screen.getByTestId('pending-op-op-gps')).toHaveTextContent('Surface Walk');
    expect(screen.getByTestId('pending-op-op-gps')).toHaveTextContent('Upload GPS track');
  });

  it('renders pending ops in the controller-provided newest-first order', () => {
    const older = { ...createOp, id: 'op-old', title: 'Older Camp', createdAt: 1000 };
    const newer = { ...createOp, id: 'op-new', title: 'Newer Camp', createdAt: 2000 };
    setup({ ops: [newer, older] });

    const rows = screen.getAllByTestId(/^pending-op-/);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Newer Camp'),
      expect.stringContaining('Older Camp'),
    ]);
  });

  it('runs per-row sync for a single op', async () => {
    const user = userEvent.setup();
    const syncOfflineOp = vi.fn(async () => summary({ succeeded: 1 }));
    const { controller } = setup({ ops: [createOp], syncOfflineOp });

    await user.click(screen.getByTestId('sync-op-op-create'));

    expect(controller.syncOfflineOp).toHaveBeenCalledWith('op-create');
  });

  it('runs Sync Now and routes conflicts into the modal', async () => {
    const user = userEvent.setup();
    const syncOfflineOps = vi.fn(async () => summary({ conflicted: 1, conflictIds: ['op-conflict'] }));
    const { controller } = setup({ ops: [conflictOp], syncOfflineOps });

    await user.click(screen.getByTestId('sync-now-button'));

    expect(controller.syncOfflineOps).toHaveBeenCalledOnce();
    expect(await screen.findByTestId('conflict-row-name')).toHaveTextContent('Mine');
    expect(screen.getByTestId('conflict-keep-local')).toBeTruthy();
  });

  it('discards a pending op', async () => {
    const user = userEvent.setup();
    const discardOfflineOp = vi.fn(async () => {});
    const { controller } = setup({ ops: [createOp], discardOfflineOp });

    await user.click(screen.getByTestId('discard-op-op-create'));

    expect(controller.discardOfflineOp).toHaveBeenCalledWith('op-create');
  });

  it('resolves a conflict by keeping the local change', async () => {
    const user = userEvent.setup();
    const resolveOfflineOpConflict = vi.fn(async () => summary({ succeeded: 1 }));
    const { controller } = setup({ ops: [conflictOp], resolveOfflineOpConflict });

    await user.click(screen.getByTestId('resolve-op-op-conflict'));
    await user.click(await screen.findByTestId('conflict-keep-local'));

    await waitFor(() =>
      expect(controller.resolveOfflineOpConflict).toHaveBeenCalledWith('op-conflict', 'local'),
    );
  });

  it('shows an offline hint and disables sync when offline-locked', () => {
    setup({ ops: [createOp], isOfflineLocked: true });
    expect(screen.getByTestId('pending-offline-hint')).toHaveTextContent('Try reconnecting');
    expect(screen.getByTestId('sync-now-button')).toBeDisabled();
    expect(screen.getByTestId('sync-op-op-create')).toBeDisabled();
    expect(screen.getByTestId('pending-try-reconnect-button')).toHaveTextContent('Try Reconnect');
  });

  it('uses the shared reconnect flow from the Pending page', async () => {
    const user = userEvent.setup();
    const attemptReconnect = vi.fn(async () => 'ok');
    const { controller } = setup({ ops: [createOp], isOfflineLocked: true, attemptReconnect });

    await user.click(screen.getByTestId('pending-try-reconnect-button'));

    await waitFor(() => expect(controller.attemptReconnect).toHaveBeenCalledOnce());
  });

  it('shows the reconnect failed modal from the Pending page', async () => {
    const user = userEvent.setup();
    const attemptReconnect = vi.fn(async () => 'network_error');
    setup({ ops: [createOp], isOfflineLocked: true, attemptReconnect });

    await user.click(screen.getByTestId('pending-try-reconnect-button'));

    expect(await screen.findByTestId('reconnect-failed-dismiss')).toBeInTheDocument();
    await user.click(screen.getByTestId('reconnect-failed-dismiss'));
    await waitFor(() => {
      expect(screen.queryByTestId('reconnect-failed-dismiss')).not.toBeInTheDocument();
    });
  });

  it('disables resolving conflicts when offline-locked', () => {
    setup({ ops: [conflictOp], isOfflineLocked: true });
    expect(screen.getByTestId('resolve-op-op-conflict')).toBeDisabled();
  });

  it('does not show a success toast when keep-local conflict resolution fails', async () => {
    const user = userEvent.setup();
    const resolveOfflineOpConflict = vi.fn(async () => summary({ failed: 1, remaining: 1 }));
    setup({ ops: [conflictOp], resolveOfflineOpConflict });

    await user.click(screen.getByTestId('resolve-op-op-conflict'));
    await user.click(await screen.findByTestId('conflict-keep-local'));

    expect(await screen.findByTestId('ion-toast')).toHaveTextContent('could not be resolved');
    expect(screen.getByTestId('ion-modal')).toBeTruthy();
  });
});
