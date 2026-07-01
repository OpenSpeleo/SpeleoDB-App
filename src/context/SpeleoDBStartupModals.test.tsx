import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectGeoJSONWarning } from '../types/projectGeoJSON';

const mockController = {
  preloadOfflineMaps: vi.fn(async () => {}),
  approveTileCacheOverLimit: vi.fn(),
  acknowledgeStoragePrompt: vi.fn(),
  clearStorageConsentRequest: vi.fn(),
  acknowledgeProjectGeoJSONWarnings: vi.fn(async () => ({
    acknowledgedCount: 1,
    failedCount: 0,
  })),
};
let mockProjectGeoJSONWarnings: ProjectGeoJSONWarning[] = [];

vi.mock('./useSpeleoDB', () => ({
  useSpeleoDB: () => ({
    authState: { isAuthenticated: true, user: null, token: null },
    controller: mockController,
    projectGeoJSONWarnings: mockProjectGeoJSONWarnings,
  }),
}));

vi.mock('@ionic/react', () => ({
  IonModal: ({
    children,
    isOpen,
    onDidDismiss,
    canDismiss,
    ...rest
  }: {
    children?: React.ReactNode;
    isOpen?: boolean;
    onDidDismiss?: () => void;
    canDismiss?: boolean | ((data?: unknown, role?: string) => Promise<boolean>);
  } & Record<string, unknown>) => {
    const testId = rest['data-testid'] as string;
    return isOpen ? (
      <div data-testid={testId}>
        {/* Lets tests simulate a dismissal (gesture / controlled close) so the
            onDidDismiss wiring is actually exercised, mirroring Ionic. */}
        <button
          data-testid={testId ? `${testId}-dismiss` : 'modal-dismiss'}
          onClick={async () => {
            const allowed = typeof canDismiss === 'function'
              ? await canDismiss(undefined, 'backdrop')
              : canDismiss !== false;
            if (allowed) onDidDismiss?.();
          }}
        >
          dismiss
        </button>
        {children}
      </div>
    ) : null;
  },
  IonContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  IonButton: ({
    children,
    onClick,
    ...rest
  }: { children?: React.ReactNode; onClick?: () => void } & Record<string, unknown>) => (
    <button
      data-testid={rest['data-testid'] as string}
      onClick={onClick}
      disabled={rest.disabled as boolean}
      aria-label={rest['aria-label'] as string}
    >
      {children}
    </button>
  ),
}));

import { SpeleoDBStartupModals } from './SpeleoDBStartupModals';
import type { StartupUiCoordinatorResult } from './useStartupUiCoordinator';

function makeStartupUi(
  overrides: Partial<StartupUiCoordinatorResult> = {},
): StartupUiCoordinatorResult {
  return {
    showConnectingBanner: false,
    showOfflineModal: false,
    showCompanionInfoModal: false,
    showStorageConsentModal: false,
    showProjectGeoJSONWarningModal: false,
    companionInfoSuppressedByGate: false,
    storageConsentSuppressedByGate: false,
    allowOfflineModalDismiss: false,
    allowCompanionInfoModalDismiss: false,
    acknowledgeOfflineMode: vi.fn(),
    handleOfflineModalDidDismiss: vi.fn(),
    handleStartExploring: vi.fn(),
    handleCompanionModalDidDismiss: vi.fn(),
    ...overrides,
  };
}

describe('SpeleoDBStartupModals storage consent', () => {
  beforeEach(() => {
    mockProjectGeoJSONWarnings = [];
    mockController.approveTileCacheOverLimit.mockReset();
    mockController.acknowledgeStoragePrompt.mockReset();
    mockController.clearStorageConsentRequest.mockReset();
    mockController.acknowledgeProjectGeoJSONWarnings.mockReset();
    mockController.acknowledgeProjectGeoJSONWarnings.mockResolvedValue({
      acknowledgedCount: 1,
      failedCount: 0,
    });
  });

  it('lists affected project names and ids and acknowledges the warning', async () => {
    mockProjectGeoJSONWarnings = [{
      projectId: 'project-123',
      projectName: 'Faulty Cave',
      commitId: 'bad-commit',
      reason: 'bbox_too_large',
      widthKm: 8_123.4,
      heightKm: 2.2,
      durationMs: 20,
      persistent: true,
    }];
    render(<SpeleoDBStartupModals startupUi={makeStartupUi({
      showProjectGeoJSONWarningModal: true,
    })} />);

    expect(screen.getByText('Project map data disabled')).toBeInTheDocument();
    expect(screen.getByText('Faulty Cave')).toBeInTheDocument();
    expect(screen.getByText('Project ID: project-123')).toBeInTheDocument();
    expect(screen.getByText(/8123\.4 km × 2\.2 km/)).toBeInTheDocument();
    expect(screen.getByText(/following project GeoJSON file will/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Acknowledge disabled project map data' }))
      .toBeInTheDocument();
    await userEvent.click(screen.getByTestId('project-geojson-warning-acknowledge'));
    expect(mockController.acknowledgeProjectGeoJSONWarnings).toHaveBeenCalledOnce();
  });

  it.each([
    ['bbox_timeout', /previous validation timed out.*retried when online/i],
    ['invalid_geojson', /not a valid GeoJSON FeatureCollection/],
    ['no_coordinates', /does not contain usable geographic coordinates/],
    ['bbox_error', /could not be measured safely/],
    ['validation_unavailable', /disabled for this session/],
  ] as const)('renders the %s reason', (reason, message) => {
    mockProjectGeoJSONWarnings = [{
      projectId: 'p1', projectName: 'Cave', commitId: 'c1', reason,
      widthKm: null, heightKm: null, durationMs: 500, persistent: reason !== 'validation_unavailable',
    }];
    render(<SpeleoDBStartupModals startupUi={makeStartupUi({
      showProjectGeoJSONWarningModal: true,
    })} />);
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it('aggregates plural warnings and refuses user-driven dismissal', async () => {
    mockProjectGeoJSONWarnings = ['p1', 'p2'].map((projectId) => ({
      projectId, projectName: `Cave ${projectId}`, commitId: 'c1', reason: 'bbox_timeout',
      widthKm: null, heightKm: null, durationMs: 500, persistent: true,
    }));
    const startupUi = makeStartupUi({ showProjectGeoJSONWarningModal: true });
    render(<SpeleoDBStartupModals startupUi={startupUi} />);
    expect(screen.getByText(/following 2 project GeoJSON files/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('project-geojson-warning-modal-dismiss'));
    expect(startupUi.handleCompanionModalDidDismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId('project-geojson-warning-modal')).toBeInTheDocument();
  });

  it('keeps the warning open and explains acknowledgement persistence failure', async () => {
    mockController.acknowledgeProjectGeoJSONWarnings.mockResolvedValueOnce({
      acknowledgedCount: 0,
      failedCount: 1,
    });
    mockProjectGeoJSONWarnings = [{
      projectId: 'p1', projectName: 'Cave', commitId: 'c1', reason: 'bbox_timeout',
      widthKm: null, heightKm: null, durationMs: 500, persistent: true,
    }];
    render(<SpeleoDBStartupModals startupUi={makeStartupUi({
      showProjectGeoJSONWarningModal: true,
    })} />);
    await userEvent.click(screen.getByTestId('project-geojson-warning-acknowledge'));
    expect(await screen.findByTestId('project-geojson-warning-error')).toHaveTextContent(
      'could not be saved',
    );
    expect(screen.getByTestId('project-geojson-warning-modal')).toBeInTheDocument();
  });

  it('disables acknowledgement while persistence is in flight', async () => {
    let resolveAcknowledgement!: (value: {
      acknowledgedCount: number;
      failedCount: number;
    }) => void;
    mockController.acknowledgeProjectGeoJSONWarnings.mockReturnValueOnce(
      new Promise((resolve) => { resolveAcknowledgement = resolve; }),
    );
    mockProjectGeoJSONWarnings = [{
      projectId: 'p1', projectName: 'Cave', commitId: 'c1', reason: 'bbox_timeout',
      widthKm: null, heightKm: null, durationMs: 500, persistent: true,
    }];
    render(<SpeleoDBStartupModals startupUi={makeStartupUi({
      showProjectGeoJSONWarningModal: true,
    })} />);

    await userEvent.click(screen.getByTestId('project-geojson-warning-acknowledge'));
    expect(screen.getByTestId('project-geojson-warning-acknowledge')).toBeDisabled();
    expect(screen.getByText('Saving…')).toBeInTheDocument();

    resolveAcknowledgement({ acknowledgedCount: 1, failedCount: 0 });
    await waitFor(() => {
      expect(screen.getByTestId('project-geojson-warning-acknowledge')).not.toBeDisabled();
    });
  });

  it('does not render the consent modal when not required', () => {
    render(<SpeleoDBStartupModals startupUi={makeStartupUi()} />);
    expect(screen.queryByTestId('storage-consent-modal')).not.toBeInTheDocument();
  });

  it('renders the consent modal and "Allow more storage" approves overflow', async () => {
    const user = userEvent.setup();
    render(
      <SpeleoDBStartupModals startupUi={makeStartupUi({ showStorageConsentModal: true })} />,
    );

    expect(screen.getByTestId('storage-consent-modal')).toBeInTheDocument();

    await user.click(screen.getByTestId('storage-consent-allow'));
    expect(mockController.approveTileCacheOverLimit).toHaveBeenCalledOnce();
    expect(mockController.acknowledgeStoragePrompt).not.toHaveBeenCalled();
  });

  it('"Not now" acknowledges the prompt so it never auto-reappears', async () => {
    const user = userEvent.setup();
    render(
      <SpeleoDBStartupModals startupUi={makeStartupUi({ showStorageConsentModal: true })} />,
    );

    await user.click(screen.getByTestId('storage-consent-decline'));
    expect(mockController.acknowledgeStoragePrompt).toHaveBeenCalledOnce();
    expect(mockController.approveTileCacheOverLimit).not.toHaveBeenCalled();
  });

  it('a genuine dismissal (not gated) acknowledges the prompt', async () => {
    const user = userEvent.setup();
    render(
      <SpeleoDBStartupModals
        startupUi={makeStartupUi({
          showStorageConsentModal: true,
          storageConsentSuppressedByGate: false,
        })}
      />,
    );

    await user.click(screen.getByTestId('storage-consent-modal-dismiss'));
    expect(mockController.acknowledgeStoragePrompt).toHaveBeenCalledOnce();
  });

  it('a gating-driven close (higher-priority modal) must NOT acknowledge', async () => {
    const user = userEvent.setup();
    render(
      <SpeleoDBStartupModals
        startupUi={makeStartupUi({
          showStorageConsentModal: true,
          storageConsentSuppressedByGate: true,
        })}
      />,
    );

    await user.click(screen.getByTestId('storage-consent-modal-dismiss'));
    // Suppressed by a gate => the user never chose; do not opt them out.
    expect(mockController.acknowledgeStoragePrompt).not.toHaveBeenCalled();
  });
});
