import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildAuthTokenUrl, authService } from './AuthService';
import { getPreferences, clearPreferences } from './PreferencesService';
import { API, PREFERENCES } from '../constants';

describe('buildAuthTokenUrl', () => {
  it('appends AUTH_TOKEN_ENDPOINT to normalized base', () => {
    expect(buildAuthTokenUrl('https://www.speleodb.org')).toBe(
      'https://www.speleodb.org' + API.AUTH_TOKEN_ENDPOINT
    );
  });

  it('strips trailing slash from base', () => {
    expect(buildAuthTokenUrl('https://api.example.com/')).toBe(
      'https://api.example.com' + API.AUTH_TOKEN_ENDPOINT
    );
  });

  it('adds https when no scheme', () => {
    expect(buildAuthTokenUrl('www.speleodb.org')).toBe(
      'https://www.speleodb.org' + API.AUTH_TOKEN_ENDPOINT
    );
  });

  it('avoids double slashes between base and path', () => {
    const url = buildAuthTokenUrl('https://host.com');
    expect(url).not.toMatch(/\/\/api/);
    expect(url).toBe('https://host.com/api/v1/user/auth-token/');
  });
});

describe('AuthService', () => {
  const validCredentials = {
    email: 'user@example.com',
    password: 'pass',
    instance: 'https://www.speleodb.org',
  };

  beforeEach(() => {
    clearPreferences();
    authService.logout();
    vi.restoreAllMocks();
  });

  describe('login (online)', () => {
    it('sends POST with FormData and on 200 saves email, token, instance to preferences', async () => {
      const token = 'abc-token';
      const userEmail = 'user@example.com';
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ user: userEmail, token }),
      } as Response);

      const result = await authService.login(validCredentials);

      expect(result.success).toBe(true);
      expect(result.token).toBe(token);

      const prefs = getPreferences();
      expect(prefs.email).toBe(userEmail);
      expect(prefs.token).toBe(token);
      expect(prefs.instance).toBe(validCredentials.instance);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe(
        'https://www.speleodb.org' + API.AUTH_TOKEN_ENDPOINT
      );
      expect(options?.method).toBe('POST');
      expect(options?.body).toBeInstanceOf(FormData);
      const formData = options?.body as FormData;
      expect(formData.get('email')).toBe(validCredentials.email);
      expect(formData.get('password')).toBe(validCredentials.password);
      expect(options?.redirect).toBe('follow');
    });

    it('on 401 returns failure and does not overwrite preferences', async () => {
      clearPreferences();
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({}),
      } as Response);

      const result = await authService.login(validCredentials);

      expect(result.success).toBe(false);
      const prefs = getPreferences();
      expect(prefs.token).toBeUndefined();
      expect(prefs.email).toBeUndefined();
    });

    it('returns failure for invalid email without calling fetch', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');
      const result = await authService.login({
        ...validCredentials,
        email: 'not-an-email',
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid email');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns failure for empty password', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');
      const result = await authService.login({
        ...validCredentials,
        password: '',
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain('Password');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns failure for empty instance', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');
      const result = await authService.login({
        ...validCredentials,
        instance: '   ',
      });
      expect(result.success).toBe(false);
      expect(result.message).toContain('instance');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('clears auth state and removes email/token from preferences', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ user: 'u@x.com', token: 't' }),
      } as Response);

      await authService.login(validCredentials);
      expect(authService.isAuthenticated()).toBe(true);

      authService.logout();
      expect(authService.isAuthenticated()).toBe(false);
      expect(authService.getCurrentUser()).toBeNull();

      const prefs = getPreferences();
      expect(prefs.email).toBeUndefined();
      expect(prefs.token).toBeUndefined();
      expect(prefs.instance).toBe(validCredentials.instance);
    });
  });

  describe('loadAuthState at startup', () => {
    it('restores authenticated state when preferences have token and instance', async () => {
      clearPreferences();
      authService.logout();
      localStorage.setItem(
        PREFERENCES.STORAGE_KEY,
        JSON.stringify({
          email: 'restored@example.com',
          token: 'saved-token',
          instance: 'https://www.speleodb.org',
        })
      );

      vi.resetModules();
      const { authService: freshService } = await import('./AuthService');
      expect(freshService.isAuthenticated()).toBe(true);
      expect(freshService.getCurrentUser()?.email).toBe('restored@example.com');
    });
  });
});
