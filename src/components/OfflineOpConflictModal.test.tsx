import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OfflineOpConflictModal from './OfflineOpConflictModal';
import type { OfflineOpConflict } from '../types/offlineOp';

// Mock Ionic so the modal renders inline (no jsdom teleport/cleanup quirks).
vi.mock('@ionic/react', () => ({
  IonModal: ({ children, isOpen }: { children?: React.ReactNode; isOpen?: boolean }) =>
    isOpen ? <div data-testid="ion-modal">{children}</div> : null,
  IonContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const updateConflict: OfflineOpConflict = {
  kind: 'update',
  title: 'Camp',
  local: { name: 'My Camp', description: '', latitude: 45.5, longitude: -122.25, collection: 'col-1' },
  server: { name: 'Their Camp', description: '', latitude: 45.5, longitude: -122.25, collection: 'col-1' },
  rows: [{ field: 'name', label: 'Name', local: 'My Camp', server: 'Their Camp' }],
};

function setup(conflict: OfflineOpConflict | null) {
  const onKeepLocal = vi.fn();
  const onUseServer = vi.fn();
  const onCancel = vi.fn();
  render(
    <OfflineOpConflictModal
      conflict={conflict}
      onKeepLocal={onKeepLocal}
      onUseServer={onUseServer}
      onCancel={onCancel}
    />,
  );
  return { onKeepLocal, onUseServer, onCancel };
}

describe('OfflineOpConflictModal', () => {
  it('renders the diff rows for an edit conflict', async () => {
    setup(updateConflict);
    expect(await screen.findByTestId('conflict-row-name')).toHaveTextContent('My Camp');
    expect(screen.getByTestId('conflict-row-name')).toHaveTextContent('Their Camp');
  });

  it('invokes keep-local and use-server callbacks', async () => {
    const user = userEvent.setup();
    const { onKeepLocal, onUseServer } = setup(updateConflict);

    await user.click(await screen.findByTestId('conflict-keep-local'));
    expect(onKeepLocal).toHaveBeenCalledOnce();

    await user.click(screen.getByTestId('conflict-use-server'));
    expect(onUseServer).toHaveBeenCalledOnce();
  });

  it('shows a delete-specific message and a "server removed it" note', async () => {
    const deleteGone: OfflineOpConflict = {
      kind: 'delete',
      title: 'Camp',
      local: null,
      server: null,
      rows: [],
    };
    setup(deleteGone);
    expect(await screen.findByTestId('conflict-server-gone')).toBeTruthy();
    expect(screen.getByTestId('conflict-keep-local')).toHaveTextContent('Delete it anyway');
  });

  it('does not render raw collection UUIDs or local ids', async () => {
    setup({
      ...updateConflict,
      title: 'Camp',
      local: {
        name: 'My Camp',
        description: '',
        latitude: 45.5,
        longitude: -122.25,
        collection: '1b6b338e-35b7-4a81-a982-c166e4301793',
      },
      server: {
        name: 'Their Camp',
        description: '',
        latitude: 45.5,
        longitude: -122.25,
        collection: 'local:temp-collection',
      },
    });

    const rendered = document.body.textContent ?? '';
    expect(rendered).not.toContain('1b6b338e-35b7-4a81-a982-c166e4301793');
    expect(rendered).not.toContain('local:');
  });
});
