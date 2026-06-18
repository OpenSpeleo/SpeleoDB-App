import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LandmarkPanel from './LandmarkPanel';
import type { LandmarkPanelProps } from './LandmarkPanel';
import type { LandmarkCollectionGroup } from '../utils/landmarkCollections';

// ==================== Mocks ====================

vi.mock('@ionic/react', () => ({
  IonToggle: ({ checked, onIonChange, ...rest }: {
    checked?: boolean;
    onIonChange?: (e: { detail: { checked: boolean } }) => void;
  } & Record<string, unknown>) => (
    <input
      type="checkbox"
      data-testid={rest['data-testid'] as string}
      aria-label={rest['aria-label'] as string}
      checked={checked}
      onChange={(e) => onIonChange?.({ detail: { checked: e.target.checked } })}
    />
  ),
}));

// ==================== Helpers ====================

const personalGroup: LandmarkCollectionGroup = {
  id: 'personal',
  name: 'Personal Landmarks',
  color: '#22c55e',
  isPersonal: true,
  count: 1,
  landmarks: [
    {
      id: 'lm-1',
      name: 'Camp',
      description: 'My camp',
      latitude: 46.6,
      longitude: 2.3,
      collectionId: 'personal',
      collectionName: 'Personal Landmarks',
      collectionColor: '#22c55e',
      isPersonalCollection: true,
    },
  ],
};

const sharedGroup: LandmarkCollectionGroup = {
  id: 'shared',
  name: 'Shared Survey',
  color: '#ef4444',
  isPersonal: false,
  count: 2,
  landmarks: [
    {
      id: 'lm-2',
      name: 'Sink',
      description: '',
      latitude: 45.1,
      longitude: 1.2,
      collectionId: 'shared',
      collectionName: 'Shared Survey',
      collectionColor: '#ef4444',
      isPersonalCollection: false,
    },
    {
      id: 'lm-3',
      name: 'Spring',
      description: '',
      latitude: 45.2,
      longitude: 1.3,
      collectionId: 'shared',
      collectionName: 'Shared Survey',
      collectionColor: '#ef4444',
      isPersonalCollection: false,
    },
  ],
};

function makeProps(overrides: Partial<LandmarkPanelProps> = {}): LandmarkPanelProps {
  return {
    groups: [personalGroup, sharedGroup],
    collectionVisibility: {},
    collectionCollapsed: {},
    onToggleCollection: vi.fn(),
    onToggleCollectionCollapsed: vi.fn(),
    onLocateLandmark: vi.fn(),
    onShowAll: vi.fn(),
    onHideAll: vi.fn(),
    onClose: vi.fn(),
    isOpen: true,
    ...overrides,
  };
}

// ==================== Tests ====================

describe('LandmarkPanel', () => {
  it('renders the empty state when there are no groups', () => {
    render(<LandmarkPanel {...makeProps({ groups: [] })} />);
    expect(screen.getByText('No landmarks available')).toBeInTheDocument();
  });

  it('renders each collection group with a Private badge for personal collections', () => {
    render(<LandmarkPanel {...makeProps()} />);
    expect(screen.getByText('Personal Landmarks')).toBeInTheDocument();
    expect(screen.getByText('Shared Survey')).toBeInTheDocument();
    expect(screen.getByTestId('collection-private-badge-personal')).toBeInTheDocument();
    expect(screen.queryByTestId('collection-private-badge-shared')).not.toBeInTheDocument();
  });

  it('shows the visible-count summary (missing key implies visible)', () => {
    render(<LandmarkPanel {...makeProps()} />);
    // 1 (personal) + 2 (shared) = 3 of 3 visible
    expect(screen.getByText('3 of 3 visible')).toBeInTheDocument();
  });

  it('excludes hidden collections from the visible-count summary', () => {
    render(<LandmarkPanel {...makeProps({ collectionVisibility: { shared: false } })} />);
    expect(screen.getByText('1 of 3 visible')).toBeInTheDocument();
  });

  it('lists landmark rows for each group', () => {
    render(<LandmarkPanel {...makeProps()} />);
    expect(screen.getByTestId('landmark-row-lm-1')).toHaveTextContent('Camp');
    expect(screen.getByTestId('landmark-row-lm-2')).toHaveTextContent('Sink');
    expect(screen.getByTestId('landmark-row-lm-3')).toHaveTextContent('Spring');
  });

  it('calls onLocateLandmark when a landmark row is tapped', async () => {
    const user = userEvent.setup();
    const onLocateLandmark = vi.fn();
    render(<LandmarkPanel {...makeProps({ onLocateLandmark })} />);

    await user.click(screen.getByTestId('landmark-row-lm-2'));

    expect(onLocateLandmark).toHaveBeenCalledWith(sharedGroup.landmarks[0]);
  });

  it('calls onToggleCollection when a collection toggle changes', async () => {
    const user = userEvent.setup();
    const onToggleCollection = vi.fn();
    render(<LandmarkPanel {...makeProps({ onToggleCollection })} />);

    await user.click(screen.getByTestId('collection-toggle-shared'));

    expect(onToggleCollection).toHaveBeenCalledWith('shared', false);
  });

  it('collapses a group via its header and hides its rows', async () => {
    const user = userEvent.setup();
    const onToggleCollectionCollapsed = vi.fn();
    const { rerender } = render(
      <LandmarkPanel {...makeProps({ onToggleCollectionCollapsed })} />,
    );

    await user.click(screen.getByTestId('collection-collapse-shared'));
    expect(onToggleCollectionCollapsed).toHaveBeenCalledWith('shared', true);

    rerender(
      <LandmarkPanel
        {...makeProps({ onToggleCollectionCollapsed, collectionCollapsed: { shared: true } })}
      />,
    );
    const sharedGroupEl = screen.getByTestId('collection-group-shared');
    expect(within(sharedGroupEl).queryByTestId('landmark-row-lm-2')).not.toBeInTheDocument();
  });

  it('wires Show all / Hide all / Close', async () => {
    const user = userEvent.setup();
    const onShowAll = vi.fn();
    const onHideAll = vi.fn();
    const onClose = vi.fn();
    render(<LandmarkPanel {...makeProps({ onShowAll, onHideAll, onClose })} />);

    await user.click(screen.getByLabelText('Show all collections'));
    await user.click(screen.getByLabelText('Hide all collections'));
    await user.click(screen.getByLabelText('Close panel'));

    expect(onShowAll).toHaveBeenCalledOnce();
    expect(onHideAll).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
