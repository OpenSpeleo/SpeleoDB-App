import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GeolocationErrorModal from './GeolocationErrorModal';

// ==================== Mocks ====================

const { mockGetPlatform } = vi.hoisted(() => ({
  mockGetPlatform: vi.fn(() => 'android'),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: mockGetPlatform },
}));

vi.mock('@ionic/react', () => ({
  IonModal: ({
    children,
    isOpen,
    onDidDismiss: _onDidDismiss,
  }: {
    children?: React.ReactNode;
    isOpen?: boolean;
    onDidDismiss?: () => void;
  }) => (isOpen ? <div data-testid="ion-modal">{children}</div> : null),
  IonContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

// ==================== Helpers ====================

function errWithCode(code: string): Error & { code: string } {
  const e = new Error('plugin error') as Error & { code: string };
  e.code = code;
  return e;
}

// ==================== Tests ====================

beforeEach(() => {
  mockGetPlatform.mockReturnValue('android');
});

describe('GeolocationErrorModal', () => {
  it('does not render when error is null', () => {
    render(<GeolocationErrorModal error={null} onDismiss={() => {}} />);
    expect(screen.queryByTestId('ion-modal')).not.toBeInTheDocument();
  });

  it('renders for permission denied error', () => {
    render(
      <GeolocationErrorModal
        error={errWithCode('OS-PLUG-GLOC-0003')}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('Location Permission Required')).toBeInTheDocument();
    expect(screen.getByText(/needs location permission/)).toBeInTheDocument();
    expect(screen.getByText(/Permissions/)).toBeInTheDocument();
  });

  it('renders for location disabled error', () => {
    render(
      <GeolocationErrorModal
        error={errWithCode('OS-PLUG-GLOC-0007')}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('Location Services Disabled')).toBeInTheDocument();
    expect(screen.getByText(/location services are turned off/)).toBeInTheDocument();
  });

  it('renders for timeout error', () => {
    render(
      <GeolocationErrorModal
        error={errWithCode('OS-PLUG-GLOC-0010')}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('Could Not Determine Location')).toBeInTheDocument();
    expect(screen.getByText(/outdoors/)).toBeInTheDocument();
  });

  it('renders for Google Play Services error', () => {
    render(
      <GeolocationErrorModal
        error={errWithCode('OS-PLUG-GLOC-0015')}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('Google Play Services Required')).toBeInTheDocument();
    expect(screen.getByText(/Google Play Store/)).toBeInTheDocument();
  });

  it('renders generic fallback for unknown error', () => {
    render(
      <GeolocationErrorModal
        error={new Error('unexpected')}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('Location Unavailable')).toBeInTheDocument();
  });

  it('shows iOS-specific instructions on ios platform', () => {
    mockGetPlatform.mockReturnValue('ios');
    render(
      <GeolocationErrorModal
        error={errWithCode('OS-PLUG-GLOC-0003')}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText(/While Using the App/)).toBeInTheDocument();
  });

  it('calls onDismiss when OK button is clicked', async () => {
    const onDismiss = vi.fn();
    render(
      <GeolocationErrorModal
        error={errWithCode('OS-PLUG-GLOC-0010')}
        onDismiss={onDismiss}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('has an OK dismiss button for every error category', () => {
    const codes = [
      'OS-PLUG-GLOC-0003',
      'OS-PLUG-GLOC-0007',
      'OS-PLUG-GLOC-0010',
      'OS-PLUG-GLOC-0015',
      'OS-PLUG-GLOC-0002',
    ];
    for (const code of codes) {
      const { unmount } = render(
        <GeolocationErrorModal
          error={errWithCode(code)}
          onDismiss={() => {}}
        />,
      );
      expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
      unmount();
    }
  });
});
