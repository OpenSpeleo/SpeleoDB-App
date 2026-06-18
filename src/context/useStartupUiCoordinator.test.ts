import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useStartupUiCoordinator } from './useStartupUiCoordinator';
import type { AuthState } from '../types';

vi.mock('../onboarding/guidedTour/runtime', () => ({
  destroyGuidedTour: vi.fn(),
  startGuidedTour: vi.fn(async () => {}),
}));

const authenticated: AuthState = {
  isAuthenticated: true,
  user: { id: 'u', email: 'a@b.co', name: 'a@b.co' },
  token: 'tok',
};

function renderCoordinator(
  overrides: Partial<Parameters<typeof useStartupUiCoordinator>[0]> = {},
) {
  // No stored session => startup validation is not pending, so the offline modal
  // gate is governed purely by the inputs under test.
  const validateSession = vi.fn(async () => 'ok' as const);
  return renderHook(() =>
    useStartupUiCoordinator({
      authState: authenticated,
      isOfflineLocked: false,
      syncStatus: 'done',
      controller: {
        validateSession,
        isAuthenticated: () => true,
      },
      history: { replace: vi.fn() },
      location: { pathname: '/dashboard' },
      getPreferences: () => ({}),
      hideSplashScreenSafely: vi.fn(),
      storageConsentRequired: true,
      ...overrides,
    }),
  );
}

describe('useStartupUiCoordinator storage-consent gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the consent modal when required and no higher-priority modal is active', () => {
    const { result } = renderCoordinator();
    expect(result.current.showStorageConsentModal).toBe(true);
    expect(result.current.storageConsentSuppressedByGate).toBe(false);
  });

  it('suppresses (does not acknowledge) the consent modal while the offline modal holds the slot', () => {
    const { result } = renderCoordinator({ isOfflineLocked: true });
    // Offline modal wins the slot.
    expect(result.current.showOfflineModal).toBe(true);
    expect(result.current.showStorageConsentModal).toBe(false);
    // Suppressed by the gate, NOT dismissed by the user.
    expect(result.current.storageConsentSuppressedByGate).toBe(true);
  });

  it('does not flag suppression when consent is not required', () => {
    const { result } = renderCoordinator({
      isOfflineLocked: true,
      storageConsentRequired: false,
    });
    expect(result.current.showStorageConsentModal).toBe(false);
    expect(result.current.storageConsentSuppressedByGate).toBe(false);
  });
});
