import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OverlayMarkerDetailsModal from './OverlayMarkerDetailsModal';
import type { OverlayMarkerDetails } from '../utils/overlayMarkerDetails';
import { allowConsoleWarn } from '../test/consoleGuard';

// ==================== Mocks ====================

const { mockShare } = vi.hoisted(() => ({
  mockShare: vi.fn(),
}));

vi.mock('@capacitor/share', () => ({
  Share: { share: mockShare },
}));

vi.mock('@ionic/react', () => ({
  IonModal: ({
    children,
    isOpen,
  }: {
    children?: React.ReactNode;
    isOpen?: boolean;
  }) => (isOpen ? <div data-testid="ion-modal">{children}</div> : null),
  IonContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

// ==================== Fixtures ====================

const landmarkDetail: OverlayMarkerDetails = {
  type: 'landmark',
  id: 'lm-1',
  name: 'Blue Spring',
  description: 'Natural spring',
  gpsCoordinate: '46.6000, 2.3000',
  collectionName: 'Shared Survey',
  isPersonalCollection: false,
  canWrite: false,
  canDelete: false,
  collectionId: 'col-shared',
  latitude: 46.6,
  longitude: 2.3,
};

const personalLandmarkDetail: OverlayMarkerDetails = {
  type: 'landmark',
  id: 'lm-2',
  name: 'Camp',
  description: 'My waypoint',
  gpsCoordinate: '46.6100, 2.3100',
  collectionName: 'Personal Landmarks',
  isPersonalCollection: true,
  canWrite: true,
  canDelete: true,
  collectionId: 'col-personal',
  latitude: 46.61,
  longitude: 2.31,
};

const mapLongPressDetail: OverlayMarkerDetails = {
  type: 'mapLongPress',
  gpsCoordinate: '46.7000, 2.4000',
  latitude: 46.7,
  longitude: 2.4,
};

const cylinderDetail: OverlayMarkerDetails = {
  type: 'cylinderInstall',
  id: 'cyl-1',
  pressure: '3000 PSI',
  gasMix: '21/35',
  installDate: '2025-06-01',
};

const explorationLeadDetail: OverlayMarkerDetails = {
  type: 'explorationLead',
  id: 'el-1',
  description: 'Narrow passage to explore',
};

const projectPointDetail: OverlayMarkerDetails = {
  type: 'projectPoint',
  id: 'pp-1',
  projectName: 'Mammoth Cave',
  name: 'Main Entrance',
  gpsCoordinate: '37.1900, -86.1000',
};

// ==================== Tests ====================

describe('OverlayMarkerDetailsModal', () => {
  beforeEach(() => {
    mockShare.mockReset().mockResolvedValue(undefined);
  });

  it('does not render when detail is null', () => {
    render(<OverlayMarkerDetailsModal detail={null} onClose={vi.fn()} />);
    expect(screen.queryByTestId('overlay-marker-details-modal')).not.toBeInTheDocument();
  });

  it('renders modal when detail is provided', () => {
    render(<OverlayMarkerDetailsModal detail={landmarkDetail} onClose={vi.fn()} />);
    expect(screen.getByTestId('overlay-marker-details-modal')).toBeInTheDocument();
  });

  it('renders correct title for landmark', () => {
    render(<OverlayMarkerDetailsModal detail={landmarkDetail} onClose={vi.fn()} />);
    expect(screen.getByText('Landmark')).toBeInTheDocument();
  });

  it('renders correct title for map long press', () => {
    render(<OverlayMarkerDetailsModal detail={mapLongPressDetail} onClose={vi.fn()} />);
    expect(screen.getByText('Map Point')).toBeInTheDocument();
  });

  it('renders correct title for cylinder install', () => {
    render(<OverlayMarkerDetailsModal detail={cylinderDetail} onClose={vi.fn()} />);
    expect(screen.getByText('Cylinder Install')).toBeInTheDocument();
  });

  it('renders correct title for exploration lead', () => {
    render(<OverlayMarkerDetailsModal detail={explorationLeadDetail} onClose={vi.fn()} />);
    expect(screen.getByText('Exploration Lead')).toBeInTheDocument();
  });

  it('renders correct title for project point', () => {
    render(<OverlayMarkerDetailsModal detail={projectPointDetail} onClose={vi.fn()} />);
    expect(screen.getByText('Project Entry Point')).toBeInTheDocument();
  });

  it('renders landmark fields', () => {
    render(<OverlayMarkerDetailsModal detail={landmarkDetail} onClose={vi.fn()} />);
    expect(screen.getByTestId('overlay-marker-name')).toHaveTextContent('Blue Spring');
    expect(screen.getByTestId('overlay-marker-description')).toHaveTextContent('Natural spring');
    expect(screen.getByTestId('overlay-marker-gps')).toHaveTextContent('46.6000, 2.3000');
  });

  it('renders landmark collection without a private badge for shared collections', () => {
    render(<OverlayMarkerDetailsModal detail={landmarkDetail} onClose={vi.fn()} />);
    expect(screen.getByTestId('overlay-marker-collection')).toHaveTextContent('Shared Survey');
    expect(screen.queryByTestId('overlay-marker-collection-private')).not.toBeInTheDocument();
  });

  it('renders a private badge for personal landmark collections', () => {
    render(<OverlayMarkerDetailsModal detail={personalLandmarkDetail} onClose={vi.fn()} />);
    expect(screen.getByTestId('overlay-marker-collection')).toHaveTextContent('Personal Landmarks');
    expect(screen.getByTestId('overlay-marker-collection-private')).toBeInTheDocument();
  });

  it('includes the collection in landmark share text', async () => {
    const user = userEvent.setup();
    render(<OverlayMarkerDetailsModal detail={personalLandmarkDetail} onClose={vi.fn()} />);

    await user.click(screen.getByTestId('share-button'));

    expect(mockShare).toHaveBeenCalledWith({
      title: 'Landmark',
      text: expect.stringContaining('Personal Landmarks (Private)'),
    });
  });

  it('renders cylinder install fields', () => {
    render(<OverlayMarkerDetailsModal detail={cylinderDetail} onClose={vi.fn()} />);
    expect(screen.getByTestId('overlay-marker-pressure')).toHaveTextContent('3000 PSI');
    expect(screen.getByTestId('overlay-marker-gas-mix')).toHaveTextContent('21/35');
    expect(screen.getByTestId('overlay-marker-install-date')).toHaveTextContent('2025-06-01');
  });

  it('renders share button', () => {
    render(<OverlayMarkerDetailsModal detail={landmarkDetail} onClose={vi.fn()} />);
    expect(screen.getByTestId('share-button')).toBeInTheDocument();
    expect(screen.getByText('Share')).toBeInTheDocument();
  });

  it('does not render share button for non-shareable marker types', () => {
    render(<OverlayMarkerDetailsModal detail={explorationLeadDetail} onClose={vi.fn()} />);
    expect(screen.queryByTestId('share-button')).not.toBeInTheDocument();
  });

  it('clicking share calls Share.share with correct content', async () => {
    const user = userEvent.setup();
    render(<OverlayMarkerDetailsModal detail={landmarkDetail} onClose={vi.fn()} />);

    await user.click(screen.getByTestId('share-button'));

    expect(mockShare).toHaveBeenCalledWith({
      title: 'Landmark',
      text: expect.stringContaining('Blue Spring'),
    });
    expect(mockShare).toHaveBeenCalledWith({
      title: 'Landmark',
      text: expect.stringContaining('46.6000, 2.3000'),
    });
  });

  it('clicking close calls onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<OverlayMarkerDetailsModal detail={landmarkDetail} onClose={onClose} />);

    await user.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('ignores share cancellation without warning', async () => {
    mockShare.mockRejectedValue(new Error('User cancelled'));
    const user = userEvent.setup();
    render(<OverlayMarkerDetailsModal detail={landmarkDetail} onClose={vi.fn()} />);

    await user.click(screen.getByTestId('share-button'));
    expect(mockShare).toHaveBeenCalled();
  });

  it('warns when share fails unexpectedly', async () => {
    allowConsoleWarn(
      '[overlay-share] Failed to share marker details.',
      expect.any(Error),
    );
    mockShare.mockRejectedValue(new Error('share bridge unavailable'));
    const user = userEvent.setup();
    render(<OverlayMarkerDetailsModal detail={landmarkDetail} onClose={vi.fn()} />);

    await user.click(screen.getByTestId('share-button'));
  });

  describe('landmark CRUD actions', () => {
    it('shows the Create Landmark button for a map long-press point', async () => {
      const onCreate = vi.fn();
      const user = userEvent.setup();
      render(
        <OverlayMarkerDetailsModal
          detail={mapLongPressDetail}
          onClose={vi.fn()}
          onCreateLandmark={onCreate}
        />,
      );

      const button = screen.getByTestId('create-landmark-button');
      expect(button).toBeInTheDocument();
      await user.click(button);
      expect(onCreate).toHaveBeenCalledOnce();
    });

    it('does not show Create Landmark when no handler is provided', () => {
      render(<OverlayMarkerDetailsModal detail={mapLongPressDetail} onClose={vi.fn()} />);
      expect(screen.queryByTestId('create-landmark-button')).not.toBeInTheDocument();
    });

    it('shows Edit and Delete for a writable landmark', async () => {
      const onEdit = vi.fn();
      const onDelete = vi.fn();
      const user = userEvent.setup();
      render(
        <OverlayMarkerDetailsModal
          detail={personalLandmarkDetail}
          onClose={vi.fn()}
          onEditLandmark={onEdit}
          onDeleteLandmark={onDelete}
        />,
      );

      await user.click(screen.getByTestId('edit-landmark-button'));
      await user.click(screen.getByTestId('delete-landmark-button'));
      expect(onEdit).toHaveBeenCalledOnce();
      expect(onDelete).toHaveBeenCalledOnce();
    });

    it('hides Edit/Delete for a read-only landmark', () => {
      render(
        <OverlayMarkerDetailsModal
          detail={landmarkDetail}
          onClose={vi.fn()}
          onEditLandmark={vi.fn()}
          onDeleteLandmark={vi.fn()}
        />,
      );
      expect(screen.queryByTestId('edit-landmark-button')).not.toBeInTheDocument();
      expect(screen.queryByTestId('delete-landmark-button')).not.toBeInTheDocument();
    });

    it('shows only Delete when the user can delete but not write', () => {
      render(
        <OverlayMarkerDetailsModal
          detail={{ ...landmarkDetail, canWrite: false, canDelete: true }}
          onClose={vi.fn()}
          onEditLandmark={vi.fn()}
          onDeleteLandmark={vi.fn()}
        />,
      );
      expect(screen.queryByTestId('edit-landmark-button')).not.toBeInTheDocument();
      expect(screen.getByTestId('delete-landmark-button')).toBeInTheDocument();
    });

    it('does not render landmark actions for non-landmark overlay types', () => {
      render(
        <OverlayMarkerDetailsModal
          detail={projectPointDetail}
          onClose={vi.fn()}
          onEditLandmark={vi.fn()}
          onDeleteLandmark={vi.fn()}
          onCreateLandmark={vi.fn()}
        />,
      );
      expect(screen.queryByTestId('edit-landmark-button')).not.toBeInTheDocument();
      expect(screen.queryByTestId('delete-landmark-button')).not.toBeInTheDocument();
      expect(screen.queryByTestId('create-landmark-button')).not.toBeInTheDocument();
    });
  });
});
