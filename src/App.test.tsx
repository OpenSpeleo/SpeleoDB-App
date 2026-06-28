import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';

const deepLinkState = vi.hoisted(() => ({
  callback: null as ((event: { url: string }) => void) | null,
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (_event: string, callback: (event: { url: string }) => void) => {
      deepLinkState.callback = callback;
      return { remove: vi.fn() };
    }),
  },
}));

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
    vi.clearAllMocks();
    localStorage.clear();
    deepLinkState.callback = null;
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

  it('never writes a deep-link URL to diagnostics', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    render(<App />);

    deepLinkState.callback?.({
      url: 'speleodb://reset?token=private-token&email=user@example.com',
    });

    expect(debug).toHaveBeenCalledWith('[DeepLink] URL received.');
    expect(JSON.stringify(debug.mock.calls)).not.toContain('private-token');
    expect(JSON.stringify(debug.mock.calls)).not.toContain('user@example.com');
  });
});
