import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GpsTrackListItem } from '../../types/gpsTrack';
import { DashboardGpsTrackDialogs } from './DashboardGpsTrackDialogs';

vi.mock('@ionic/react', () => ({
  IonModal: ({ children, isOpen }: { children?: React.ReactNode; isOpen?: boolean }) => (
    isOpen ? <div>{children}</div> : null
  ),
  IonContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../components/ConfirmDialog', () => ({
  default: ({
    isOpen,
    message,
    warning,
  }: {
    isOpen: boolean;
    message: React.ReactNode;
    warning?: React.ReactNode;
  }) => (isOpen ? <div>{message}{warning}</div> : null),
}));

const LOCAL_TRACK: GpsTrackListItem = {
  id: 'local-1',
  name: 'Local survey',
  color: '#e41a1c',
  origin: 'local',
  createdAt: 1,
  updatedAt: 1,
};

describe('Dashboard GPS presentation', () => {
  it('renders local deletion and busy editing while forwarding field changes', () => {
    const onEditNameChange = vi.fn();
    const onEditColorChange = vi.fn();
    render(
      <DashboardGpsTrackDialogs
        uploadTarget={null}
        uploadBusy={false}
        onConfirmUpload={vi.fn()}
        onCancelUpload={vi.fn()}
        deleteTarget={LOCAL_TRACK}
        deleteBusy={false}
        onConfirmDelete={vi.fn()}
        onCancelDelete={vi.fn()}
        editTarget={LOCAL_TRACK}
        editName="Local survey"
        editColor="#e41a1c"
        editBusy
        onEditNameChange={onEditNameChange}
        onEditColorChange={onEditColorChange}
        onConfirmEdit={vi.fn()}
        onCancelEdit={vi.fn()}
      />,
    );

    expect(screen.getByText(/This removes the recording from this device/)).toBeInTheDocument();
    expect(screen.getByTestId('gps-edit-save')).toHaveTextContent('Saving…');
    fireEvent.change(screen.getByTestId('gps-edit-name-input'), {
      target: { value: 'Renamed survey' },
    });
    fireEvent.click(screen.getByTestId('gps-edit-color-#377eb8'));
    expect(onEditNameChange).toHaveBeenCalledWith('Renamed survey');
    expect(onEditColorChange).toHaveBeenCalledWith('#377eb8');
  });

  it('describes remote deletion as a SpeleoDB operation', () => {
    render(
      <DashboardGpsTrackDialogs
        uploadTarget={null}
        uploadBusy={false}
        onConfirmUpload={vi.fn()}
        onCancelUpload={vi.fn()}
        deleteTarget={{ ...LOCAL_TRACK, origin: 'remote' }}
        deleteBusy={false}
        onConfirmDelete={vi.fn()}
        onCancelDelete={vi.fn()}
        editTarget={null}
        editName=""
        editColor=""
        editBusy={false}
        onEditNameChange={vi.fn()}
        onEditColorChange={vi.fn()}
        onConfirmEdit={vi.fn()}
        onCancelEdit={vi.fn()}
      />,
    );

    expect(screen.getByText(/This removes the track from SpeleoDB/)).toBeInTheDocument();
  });
});
