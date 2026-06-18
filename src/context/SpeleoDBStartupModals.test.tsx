import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockController = {
  preloadTilePrefetch: vi.fn(async () => {}),
  approveTileCacheOverLimit: vi.fn(),
  acknowledgeStoragePrompt: vi.fn(),
  clearStorageConsentRequest: vi.fn(),
};

vi.mock('./useSpeleoDB', () => ({
  useSpeleoDB: () => ({
    authState: { isAuthenticated: true, user: null, token: null },
    controller: mockController,
  }),
}));

vi.mock('../services/TileCacheRuntime', () => ({
  runTileCacheStartupMaintenanceRuntime: vi.fn(async () => {}),
}));

vi.mock('@ionic/react', () => ({
  IonModal: ({
    children,
    isOpen,
    onDidDismiss,
    ...rest
  }: {
    children?: React.ReactNode;
    isOpen?: boolean;
    onDidDismiss?: () => void;
  } & Record<string, unknown>) => {
    const testId = rest['data-testid'] as string;
    return isOpen ? (
      <div data-testid={testId}>
        {/* Lets tests simulate a dismissal (gesture / controlled close) so the
            onDidDismiss wiring is actually exercised, mirroring Ionic. */}
        <button
          data-testid={testId ? `${testId}-dismiss` : 'modal-dismiss'}
          onClick={() => onDidDismiss?.()}
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
    <button data-testid={rest['data-testid'] as string} onClick={onClick}>
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
    mockController.approveTileCacheOverLimit.mockReset();
    mockController.acknowledgeStoragePrompt.mockReset();
    mockController.clearStorageConsentRequest.mockReset();
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
