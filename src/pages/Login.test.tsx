import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'react-router-dom';
import { createMemoryHistory } from 'history';
import Login from './Login';
import { PREFERENCES } from '../constants';
import { clearPreferences, setPreferences } from '../services/PreferencesService';

const { mockBrowserOpen } = vi.hoisted(() => ({
  mockBrowserOpen: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@capacitor/browser', () => ({
  Browser: { open: mockBrowserOpen },
}));

// Mock the SpeleoDBProvider hook -- return a fake controller.
const mockLogin = vi.fn();
const mockLoginWithToken = vi.fn();

vi.mock('../context/useSpeleoDB', () => ({
  useSpeleoDB: () => ({
    controller: {
      login: mockLogin,
      loginWithToken: mockLoginWithToken,
    },
    authState: { isAuthenticated: false, user: null, token: null },
    isOnline: true,
    isOfflineLocked: false,
    projects: [],
    syncStatus: 'idle',
    lastSyncedAt: null,
    tilePrefetchJobs: [],
  }),
}));

function renderLogin() {
  const history = createMemoryHistory();
  render(
    <Router history={history}>
      <Login />
    </Router>
  );
  return history;
}

function getOAuthTokenInput() {
  return within(
    screen.getByRole('tabpanel', { name: /oauth token/i }),
  ).getByLabelText(/^oauth token$/i);
}

function submitPasswordForm(): HTMLFormElement {
  fireEvent.change(screen.getByLabelText(/^email$/i), {
    target: { value: 'user@example.com' },
  });
  fireEvent.change(screen.getByLabelText(/^password$/i), {
    target: { value: 'password' },
  });
  const form = screen.getByRole('button', { name: /sign in/i }).closest('form');
  if (!form) throw new Error('Login submit button must belong to a form');
  fireEvent.submit(form);
  return form;
}

describe('Login page', () => {
  beforeEach(() => {
    mockLogin.mockReset();
    mockLoginWithToken.mockReset();
    mockBrowserOpen.mockClear();
    clearPreferences();
  });

  it('renders email, password, and instance fields', () => {
    renderLogin();
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/speleodb instance/i)).toBeInTheDocument();
  });

  it('omits the offline access, native autofill, and token connection notes', async () => {
    renderLogin();

    expect(screen.queryByText(/offline access requires/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/native password autofill uses credentials/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/token sign-in requires a connection/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /oauth token/i }));
    expect(screen.queryByText(/offline access requires/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/native password autofill uses credentials/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/token sign-in requires a connection/i)).not.toBeInTheDocument();
  });

  it('renders accessible login tabs and switches credential fields', async () => {
    renderLogin();
    const passwordTab = screen.getByRole('tab', { name: /email & password/i });
    const tokenTab = screen.getByRole('tab', { name: /oauth token/i });

    expect(passwordTab).toHaveAttribute('aria-selected', 'true');
    expect(tokenTab).toHaveAttribute('aria-selected', 'false');

    await userEvent.click(tokenTab);

    expect(passwordTab).toHaveAttribute('aria-selected', 'false');
    expect(tokenTab).toHaveAttribute('aria-selected', 'true');
    expect(getOAuthTokenInput()).toBeInTheDocument();
    expect(screen.queryByLabelText(/^email$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/forgot\?/i)).not.toBeInTheDocument();
  });

  it('supports keyboard navigation between login tabs', async () => {
    renderLogin();
    const passwordTab = screen.getByRole('tab', { name: /email & password/i });
    const tokenTab = screen.getByRole('tab', { name: /oauth token/i });

    passwordTab.focus();
    await userEvent.keyboard('{ArrowRight}');

    expect(tokenTab).toHaveFocus();
    expect(tokenTab).toHaveAttribute('aria-selected', 'true');
    expect(getOAuthTokenInput()).toBeInTheDocument();
  });

  it('keeps entered credentials when switching login methods', async () => {
    renderLogin();

    await userEvent.type(screen.getByLabelText(/^email$/i), 'user@example.com');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'password');
    await userEvent.click(screen.getByRole('tab', { name: /oauth token/i }));
    await userEvent.type(getOAuthTokenInput(), 'oauth-token');
    await userEvent.click(screen.getByRole('tab', { name: /email & password/i }));

    expect(screen.getByLabelText(/^email$/i)).toHaveValue('user@example.com');
    expect(screen.getByLabelText(/^password$/i)).toHaveValue('password');

    await userEvent.click(screen.getByRole('tab', { name: /oauth token/i }));
    expect(getOAuthTokenInput()).toHaveValue('oauth-token');
  });

  it('masks the OAuth token and disables browser autofill', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('tab', { name: /oauth token/i }));

    const tokenInput = getOAuthTokenInput();
    expect(tokenInput).toHaveAttribute('type', 'password');
    expect(tokenInput).toHaveAttribute('autocomplete', 'off');
    expect(tokenInput).toHaveAttribute('autocapitalize', 'none');
    expect(tokenInput).toHaveAttribute('spellcheck', 'false');
  });

  it('uses native credential autofill semantics for login fields', () => {
    renderLogin();

    expect(screen.getByLabelText(/^email$/i)).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute('autocomplete', 'current-password');
  });

  it('pre-fills instance with DEFAULT_INSTANCE', () => {
    renderLogin();
    const instanceInput = screen.getByLabelText(/speleodb instance/i);
    expect(instanceInput).toHaveValue(PREFERENCES.DEFAULT_INSTANCE);
  });

  it('pre-fills instance with persisted instance preference when available', () => {
    setPreferences({ instance: 'https://custom.instance.example' });

    renderLogin();
    const instanceInput = screen.getByLabelText(/speleodb instance/i);
    expect(instanceInput).toHaveValue('https://custom.instance.example');
  });

  it('on successful login redirects to /dashboard', async () => {
    mockLogin.mockResolvedValue({ success: true, message: 'Login successful' });
    const history = renderLogin();

    await userEvent.type(screen.getByLabelText(/^email$/i), 'user@example.com');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'password');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(
      () => { expect(history.location.pathname).toBe('/dashboard'); },
      { timeout: 2000 }
    );
  });

  it('admits only one submission and stays locked through a successful redirect', async () => {
    let resolveLogin!: (value: { success: boolean; message: string }) => void;
    mockLogin.mockImplementation(() => new Promise((resolve) => {
      resolveLogin = resolve;
    }));
    renderLogin();
    const form = submitPasswordForm();
    fireEvent.submit(form);
    expect(mockLogin).toHaveBeenCalledOnce();

    await act(async () => {
      resolveLogin({ success: true, message: 'Login successful' });
    });

    expect(screen.getByText(/login successful/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();
    fireEvent.submit(form);
    expect(mockLogin).toHaveBeenCalledOnce();
  });

  it('cancels the delayed successful-login redirect when unmounted', async () => {
    vi.useFakeTimers();
    try {
      mockLogin.mockResolvedValue({ success: true, message: 'Login successful' });
      const history = createMemoryHistory();
      const { unmount } = render(
        <Router history={history}>
          <Login />
        </Router>,
      );
      submitPasswordForm();
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByText(/login successful/i)).toBeInTheDocument();

      unmount();
      act(() => { vi.advanceTimersByTime(1000); });

      expect(history.location.pathname).toBe('/');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a successful controller completion after unmount', async () => {
    vi.useFakeTimers();
    try {
      let resolveLogin!: (value: { success: boolean; message: string }) => void;
      mockLogin.mockImplementation(() => new Promise((resolve) => {
        resolveLogin = resolve;
      }));
      const history = createMemoryHistory();
      const { unmount } = render(
        <Router history={history}>
          <Login />
        </Router>,
      );
      submitPasswordForm();

      unmount();
      await act(async () => {
        resolveLogin({ success: true, message: 'Login successful' });
      });
      act(() => { vi.runAllTimers(); });

      expect(history.location.pathname).toBe('/');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows unexpected controller failures and reopens form admission', async () => {
    mockLogin.mockRejectedValue(new Error('unexpected failure'));
    renderLogin();
    await userEvent.type(screen.getByLabelText(/^email$/i), 'user@example.com');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'password');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/an unexpected error occurred/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign in/i })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: /^sign in/i }));
    expect(mockLogin).toHaveBeenCalledTimes(2);
  });

  it('on failed login shows error and does not redirect', async () => {
    mockLogin.mockResolvedValue({ success: false, message: 'Invalid email or password' });
    const history = renderLogin();

    await userEvent.type(screen.getByLabelText(/^email$/i), 'user@example.com');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument();
    });
    expect(history.location.pathname).not.toBe('/dashboard');
  });

  it('passes instance to controller.login', async () => {
    mockLogin.mockResolvedValue({ success: true, message: 'OK' });
    renderLogin();
    const instanceInput = screen.getByLabelText(/speleodb instance/i);

    await userEvent.clear(instanceInput);
    await userEvent.type(instanceInput, 'https://custom.speleodb.org');
    await userEvent.type(screen.getByLabelText(/^email$/i), 'u@x.com');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'pass');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith({
        email: 'u@x.com',
        password: 'pass',
        instance: 'https://custom.speleodb.org',
      });
    });
  });

  it('passes the token and shared instance to controller.loginWithToken', async () => {
    mockLoginWithToken.mockResolvedValue({ success: true, message: 'OK' });
    renderLogin();
    await userEvent.click(screen.getByRole('tab', { name: /oauth token/i }));

    const instanceInput = screen.getByLabelText(/speleodb instance/i);
    await userEvent.clear(instanceInput);
    await userEvent.type(instanceInput, 'https://custom.speleodb.org');
    await userEvent.type(getOAuthTokenInput(), 'oauth-token');
    await userEvent.click(screen.getByRole('button', { name: /sign in with token/i }));

    await waitFor(() => {
      expect(mockLoginWithToken).toHaveBeenCalledWith({
        token: 'oauth-token',
        instance: 'https://custom.speleodb.org',
      });
    });
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('shows token validation failures without redirecting', async () => {
    mockLoginWithToken.mockResolvedValue({ success: false, message: 'Invalid OAuth token' });
    const history = renderLogin();
    await userEvent.click(screen.getByRole('tab', { name: /oauth token/i }));
    await userEvent.type(getOAuthTokenInput(), 'invalid-token');
    await userEvent.click(screen.getByRole('button', { name: /sign in with token/i }));

    expect(await screen.findByText(/invalid oauth token/i)).toBeInTheDocument();
    expect(history.location.pathname).not.toBe('/dashboard');
  });

  it('redirects after successful OAuth token login', async () => {
    mockLoginWithToken.mockResolvedValue({ success: true, message: 'Login successful' });
    const history = renderLogin();
    await userEvent.click(screen.getByRole('tab', { name: /oauth token/i }));
    await userEvent.type(getOAuthTokenInput(), 'oauth-token');
    await userEvent.click(screen.getByRole('button', { name: /sign in with token/i }));

    await waitFor(
      () => { expect(history.location.pathname).toBe('/dashboard'); },
      { timeout: 2000 },
    );
  });

  it('disables login tabs and shows token-specific loading feedback while validating', async () => {
    let resolveLogin!: (value: { success: boolean; message: string }) => void;
    mockLoginWithToken.mockImplementation(() => new Promise((resolve) => {
      resolveLogin = resolve;
    }));
    renderLogin();
    await userEvent.click(screen.getByRole('tab', { name: /oauth token/i }));
    await userEvent.type(getOAuthTokenInput(), 'oauth-token');
    await userEvent.click(screen.getByRole('button', { name: /sign in with token/i }));

    expect(await screen.findByRole('button', { name: /validating token/i })).toBeDisabled();
    expect(screen.getByRole('tab', { name: /email & password/i })).toBeDisabled();
    expect(screen.getByRole('tab', { name: /oauth token/i })).toBeDisabled();

    resolveLogin({ success: false, message: 'Invalid OAuth token' });
    expect(await screen.findByText(/invalid oauth token/i)).toBeInTheDocument();
  });

  it('opens forgot-password link via Browser.open', async () => {
    renderLogin();
    await userEvent.click(screen.getByText(/forgot\?/i));

    expect(mockBrowserOpen).toHaveBeenCalledWith({
      url: `${PREFERENCES.DEFAULT_INSTANCE}/account/password/reset/`,
    });
  });

  it('opens Get OAuth Token in the native browser for the currently selected instance', async () => {
    renderLogin();
    expect(screen.queryByRole('link', { name: 'Get OAuth Token' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /oauth token/i }));

    const link = screen.getByRole('link', { name: 'Get OAuth Token' });
    expect(link).toHaveClass('app-btn', 'app-btn--secondary');
    expect(link).not.toHaveAttribute('target');
    expect(link).toHaveAttribute('href', `${PREFERENCES.DEFAULT_INSTANCE}/private/auth-token/`);
    await userEvent.click(link);
    expect(mockBrowserOpen).toHaveBeenLastCalledWith({
      url: `${PREFERENCES.DEFAULT_INSTANCE}/private/auth-token/`,
    });

    fireEvent.change(screen.getByLabelText(/speleodb instance/i), {
      target: { value: 'https://custom.speleodb.org/' },
    });
    expect(link).toHaveAttribute('href', 'https://custom.speleodb.org/private/auth-token/');
    await userEvent.click(link);
    expect(mockBrowserOpen).toHaveBeenLastCalledWith({
      url: 'https://custom.speleodb.org/private/auth-token/',
    });
    expect(mockBrowserOpen).toHaveBeenCalledTimes(2);
    expect(mockLoginWithToken).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('tab', { name: /email & password/i }));
    expect(screen.queryByRole('link', { name: 'Get OAuth Token' })).not.toBeInTheDocument();
  });

  it('opens sign-up link via Browser.open', async () => {
    renderLogin();
    await userEvent.click(screen.getByText(/sign up/i));

    expect(mockBrowserOpen).toHaveBeenCalledWith({
      url: `${PREFERENCES.DEFAULT_INSTANCE}/signup/`,
    });
  });

  it.each([
    { name: 'Forgot?', method: 'password' },
    { name: 'Sign up', method: 'password' },
    { name: 'Get OAuth Token', method: 'token' },
  ])('reports a browser failure for $name and allows retry', async ({ name, method }) => {
    mockBrowserOpen.mockRejectedValueOnce(new Error('Native browser unavailable: private URL details'));
    renderLogin();
    if (method === 'token') {
      await userEvent.click(screen.getByRole('tab', { name: /oauth token/i }));
    }

    const link = screen.getByRole('link', { name });
    await userEvent.click(link);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to open the browser. Please try again.',
    );
    expect(screen.queryByText(/private URL details/)).not.toBeInTheDocument();

    await userEvent.click(link);
    expect(mockBrowserOpen).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mockLogin).not.toHaveBeenCalled();
    expect(mockLoginWithToken).not.toHaveBeenCalled();
  });

  it('handles a pending browser rejection after leaving Login', async () => {
    let rejectBrowser!: (error: Error) => void;
    mockBrowserOpen.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      rejectBrowser = reject;
    }));
    const { unmount } = render(
      <Router history={createMemoryHistory()}>
        <Login />
      </Router>,
    );
    await userEvent.click(screen.getByRole('tab', { name: /oauth token/i }));
    await userEvent.click(screen.getByRole('link', { name: 'Get OAuth Token' }));
    expect(mockBrowserOpen).toHaveBeenCalledTimes(1);
    unmount();

    await act(async () => {
      rejectBrowser(new Error('Browser presentation failed'));
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not use target="_blank" on external links', () => {
    renderLogin();
    const forgotLink = screen.getByText(/forgot\?/i);
    const signupLink = screen.getByText(/sign up/i);

    expect(forgotLink).not.toHaveAttribute('target');
    expect(signupLink).not.toHaveAttribute('target');
  });

  it('uses Browser.open with custom instance for external links', async () => {
    setPreferences({ instance: 'https://custom.speleodb.org' });
    renderLogin();

    await userEvent.click(screen.getByText(/forgot\?/i));
    expect(mockBrowserOpen).toHaveBeenCalledWith({
      url: 'https://custom.speleodb.org/account/password/reset/',
    });

    mockBrowserOpen.mockClear();

    await userEvent.click(screen.getByText(/sign up/i));
    expect(mockBrowserOpen).toHaveBeenCalledWith({
      url: 'https://custom.speleodb.org/signup/',
    });
  });

  it('gives every app button a solid color variant with no background utility', () => {
    const { container } = render(
      <Router history={createMemoryHistory()}>
        <Login />
      </Router>,
    );

    const buttons = container.querySelectorAll('button.app-btn');
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((button) => {
      const className = button.getAttribute('class') ?? '';
      expect(/app-btn--(primary|secondary|danger|info|success)/.test(className)).toBe(true);
      expect(/\bbg-/.test(className)).toBe(false);
    });
  });
});
