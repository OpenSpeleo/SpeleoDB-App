import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

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

  it('gives project GeoJSON warnings priority over storage consent', () => {
    const { result } = renderCoordinator({ hasProjectGeoJSONWarnings: true });
    expect(result.current.showProjectGeoJSONWarningModal).toBe(true);
    expect(result.current.showStorageConsentModal).toBe(false);
    expect(result.current.storageConsentSuppressedByGate).toBe(true);
  });

  it('keeps exactly one modal active when offline preempts companion onboarding', async () => {
    type Props = Parameters<typeof useStartupUiCoordinator>[0];
    const unauthenticated: AuthState = { isAuthenticated: false, user: null, token: null };
    const makeProps = (authState: AuthState, isOfflineLocked = false): Props => ({
      authState,
      isOfflineLocked,
      syncStatus: 'done',
      controller: {
        validateSession: vi.fn(async () => 'ok' as const),
        isAuthenticated: () => authState.isAuthenticated,
      },
      history: { replace: vi.fn() },
      location: { pathname: '/dashboard' },
      getPreferences: () => ({}),
      hideSplashScreenSafely: vi.fn(),
      storageConsentRequired: true,
      hasProjectGeoJSONWarnings: true,
    });
    const { result, rerender } = renderHook(
      (props: Props) => useStartupUiCoordinator(props),
      { initialProps: makeProps(unauthenticated) },
    );

    await act(async () => {
      rerender(makeProps(authenticated));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.showCompanionInfoModal).toBe(true);
    expect(result.current.showProjectGeoJSONWarningModal).toBe(false);
    expect(result.current.showStorageConsentModal).toBe(false);

    rerender(makeProps(authenticated, true));
    expect(result.current.showOfflineModal).toBe(true);
    expect(result.current.showCompanionInfoModal).toBe(false);
    expect(result.current.companionInfoSuppressedByGate).toBe(true);
    expect(result.current.showProjectGeoJSONWarningModal).toBe(false);
    expect(result.current.showStorageConsentModal).toBe(false);
  });
});

describe('useStartupUiCoordinator runtime offline modal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  type CoordinatorProps = Parameters<typeof useStartupUiCoordinator>[0];

  // No stored session => startup validation is not pending and validateSession
  // is never called, so the offline modal gate depends purely on isOfflineLocked
  // and the acknowledge/clear lifecycle.
  function makeProps(overrides: Partial<CoordinatorProps> = {}): CoordinatorProps {
    return {
      authState: authenticated,
      isOfflineLocked: false,
      syncStatus: 'done',
      controller: {
        validateSession: vi.fn(async () => 'ok' as const),
        isAuthenticated: () => true,
      },
      history: { replace: vi.fn() },
      location: { pathname: '/dashboard' },
      getPreferences: () => ({}),
      hideSplashScreenSafely: vi.fn(),
      storageConsentRequired: false,
      ...overrides,
    };
  }

  it('shows the offline modal when the app flips offline at runtime', () => {
    const { result, rerender } = renderHook(
      (props: CoordinatorProps) => useStartupUiCoordinator(props),
      { initialProps: makeProps() },
    );

    // Online at startup, validation done, never acknowledged => no modal.
    expect(result.current.showOfflineModal).toBe(false);

    // A failed Resync flips the controller offline (isOfflineLocked true).
    rerender(makeProps({ isOfflineLocked: true }));
    expect(result.current.showOfflineModal).toBe(true);
  });

  it('re-shows the offline modal after a prior Go Offline acknowledgement and a reconnect', async () => {
    const { result, rerender } = renderHook(
      (props: CoordinatorProps) => useStartupUiCoordinator(props),
      { initialProps: makeProps({ isOfflineLocked: true }) },
    );

    // First offline period: modal shows, user taps "Go Offline".
    expect(result.current.showOfflineModal).toBe(true);
    act(() => {
      result.current.acknowledgeOfflineMode();
    });
    expect(result.current.showOfflineModal).toBe(false);

    // Go Online succeeds -> lock clears. The coordinator re-arms the modal
    // (offline_lock_cleared resets the acknowledgement) via a microtask.
    await act(async () => {
      rerender(makeProps({ isOfflineLocked: false }));
    });
    expect(result.current.showOfflineModal).toBe(false);

    // A later runtime flip back to offline must show the modal again.
    rerender(makeProps({ isOfflineLocked: true }));
    expect(result.current.showOfflineModal).toBe(true);
  });
});
