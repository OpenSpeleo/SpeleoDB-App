import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'react-router-dom';
import { createMemoryHistory } from 'history';
import Login from './Login';
import { PREFERENCES } from '../constants';

// Mock the SpeleoDBProvider hook -- return a fake controller.
const mockLogin = vi.fn();

vi.mock('../context/SpeleoDBProvider', () => ({
  useSpeleoDB: () => ({
    controller: {
      login: mockLogin,
      retryConnection: vi.fn(),
    },
    authState: { isAuthenticated: false, user: null, token: null },
    isOnline: true,
    isOfflineLocked: false,
    isRetryingConnection: false,
    projects: [],
    syncStatus: 'idle',
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

describe('Login page', () => {
  beforeEach(() => {
    mockLogin.mockReset();
  });

  it('renders email, password, and instance fields', () => {
    renderLogin();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/speleodb instance/i)).toBeInTheDocument();
  });

  it('pre-fills instance with DEFAULT_INSTANCE', () => {
    renderLogin();
    const instanceInput = screen.getByLabelText(/speleodb instance/i);
    expect(instanceInput).toHaveValue(PREFERENCES.DEFAULT_INSTANCE);
  });

  it('on successful login redirects to /dashboard', async () => {
    mockLogin.mockResolvedValue({ success: true, message: 'Login successful' });
    const history = renderLogin();

    await userEvent.type(screen.getByLabelText(/email/i), 'user@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'password');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(
      () => { expect(history.location.pathname).toBe('/dashboard'); },
      { timeout: 2000 }
    );
  });

  it('on failed login shows error and does not redirect', async () => {
    mockLogin.mockResolvedValue({ success: false, message: 'Invalid email or password' });
    const history = renderLogin();

    await userEvent.type(screen.getByLabelText(/email/i), 'user@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
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
    await userEvent.type(screen.getByLabelText(/email/i), 'u@x.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'pass');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith({
        email: 'u@x.com',
        password: 'pass',
        instance: 'https://custom.speleodb.org',
      });
    });
  });
});
