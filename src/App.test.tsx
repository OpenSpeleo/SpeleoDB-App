import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';

vi.mock('@capacitor/splash-screen', () => ({
  SplashScreen: { hide: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('@capacitor/haptics', () => ({
  Haptics: {
    impact: vi.fn().mockResolvedValue(undefined),
    notification: vi.fn().mockResolvedValue(undefined),
    selectionStart: vi.fn().mockResolvedValue(undefined),
    selectionChanged: vi.fn().mockResolvedValue(undefined),
    selectionEnd: vi.fn().mockResolvedValue(undefined),
  },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
  NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
}));

vi.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    getCurrentPosition: vi.fn(),
    requestPermissions: vi.fn().mockResolvedValue({ location: 'granted' }),
  },
}));

vi.mock('@capacitor/share', () => ({
  Share: { share: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('./services/AppSessionStore', () => ({
  appSessionStore: {
    initialize: vi.fn(async () => null),
    getSession: vi.fn(() => null),
    establish: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  },
}));

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders without crashing', () => {
    const { baseElement } = render(<App />);
    expect(baseElement).toBeDefined();
  });

  it('shows login page by default when not authenticated', async () => {
    render(<App />);
    expect(await screen.findByLabelText(/^email$/i)).toBeInTheDocument();
  });

  it('hides the native splash on the default route', async () => {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    render(<App />);
    await waitFor(() => {
      expect(SplashScreen.hide).toHaveBeenCalled();
    });
  });
});
