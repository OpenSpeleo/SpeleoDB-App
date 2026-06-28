import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PREFERENCES } from '../constants';
import type { CredentialStore } from './CredentialStore';
import { createAppSessionStore } from './AppSessionStore';

describe('createAppSessionStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps browser preview sessions in memory without persisting credentials', async () => {
    const sessions = createAppSessionStore(() => false);
    await sessions.initialize();

    await sessions.establish({
      email: 'browser@example.com',
      instance: 'https://speleodb.org',
      token: 'volatile-token',
    });

    expect(sessions.getSession()).toEqual({
      email: 'browser@example.com',
      instance: 'https://speleodb.org',
      token: 'volatile-token',
    });
    expect(localStorage.getItem(PREFERENCES.STORAGE_KEY)).toBeNull();
    await expect(createAppSessionStore(() => false).initialize()).resolves.toBeNull();

    await sessions.clear();
    expect(sessions.getSession()).toBeNull();
  });

  it('uses the native credential and persistent metadata stores on device', async () => {
    let token: string | null = null;
    const credentials: CredentialStore = {
      readToken: vi.fn(async () => token),
      writeToken: vi.fn(async (next) => { token = next; }),
      clearToken: vi.fn(async () => { token = null; }),
    };
    const sessions = createAppSessionStore(() => true, credentials);
    await sessions.initialize();

    await sessions.establish({
      instance: 'https://speleodb.org',
      token: 'native-token',
    });

    expect(credentials.writeToken).toHaveBeenCalledWith('native-token');
    const raw = localStorage.getItem(PREFERENCES.STORAGE_KEY) ?? '';
    expect(raw).not.toContain('native-token');
    expect(JSON.parse(raw)).toMatchObject({
      hasStoredSession: true,
      instance: 'https://speleodb.org',
    });
  });
});
