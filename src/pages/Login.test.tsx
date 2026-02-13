import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'react-router-dom';
import { createMemoryHistory } from 'history';
import Login from './Login';
import { OnlineStateProvider } from '../context/OnlineState';
import { PREFERENCES } from '../constants';
import * as AuthServiceModule from '../services/AuthService';

vi.mock('../services/AuthService', () => ({
  authService: {
    login: vi.fn(),
  },
}));

const authService = AuthServiceModule.authService as unknown as { login: ReturnType<typeof vi.fn> };

function renderLogin() {
  const history = createMemoryHistory();
  render(
    <Router history={history}>
      <OnlineStateProvider>
        <Login />
      </OnlineStateProvider>
    </Router>
  );
  return history;
}

describe('Login page', () => {
  beforeEach(() => {
    vi.mocked(authService.login).mockReset();
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
    vi.mocked(authService.login).mockResolvedValue({
      success: true,
      message: 'Login successful',
    });
    const history = renderLogin();

    await userEvent.type(screen.getByLabelText(/email/i), 'user@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'password');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(
      () => {
        expect(history.location.pathname).toBe('/dashboard');
      },
      { timeout: 2000 }
    );
  });

  it('on failed login shows error and does not redirect', async () => {
    vi.mocked(authService.login).mockResolvedValue({
      success: false,
      message: 'Invalid email or password',
    });
    const history = renderLogin();

    await userEvent.type(screen.getByLabelText(/email/i), 'user@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument();
    });
    expect(history.location.pathname).not.toBe('/dashboard');
  });

  it('passes instance to authService.login', async () => {
    vi.mocked(authService.login).mockResolvedValue({
      success: true,
      message: 'OK',
    });
    const history = renderLogin();
    const instanceInput = screen.getByLabelText(/speleodb instance/i);

    await userEvent.clear(instanceInput);
    await userEvent.type(instanceInput, 'https://custom.speleodb.org');
    await userEvent.type(screen.getByLabelText(/email/i), 'u@x.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'pass');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(authService.login).toHaveBeenCalledWith({
        email: 'u@x.com',
        password: 'pass',
        instance: 'https://custom.speleodb.org',
      });
    });
  });
});
