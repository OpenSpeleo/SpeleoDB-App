import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PREFERENCES } from '../constants';
import type { CredentialStore } from '../services/CredentialStore';
import { sessionMetadataStore } from '../services/PreferencesService';
import { SecureSessionStore } from '../services/SecureSessionStore';

function createCredentialStore(initial: string | null = null) {
  let token = initial;
  const credentials: CredentialStore = {
    readToken: vi.fn(async () => token),
    writeToken: vi.fn(async (next) => { token = next; }),
    clearToken: vi.fn(async () => { token = null; }),
  };
  return { credentials, getToken: () => token };
}

describe('secure session migration integration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('moves a legacy token out of localStorage without losing preferences', async () => {
    localStorage.setItem(PREFERENCES.STORAGE_KEY, JSON.stringify({
      email: 'legacy@example.com',
      instance: 'https://speleodb.org',
      projectVisibility: { project: false },
      token: 'legacy-secret',
    }));
    const { credentials, getToken } = createCredentialStore();
    const sessions = new SecureSessionStore(credentials, sessionMetadataStore);

    await expect(sessions.initialize()).resolves.toEqual({
      email: 'legacy@example.com',
      instance: 'https://speleodb.org',
      token: 'legacy-secret',
    });

    const raw = localStorage.getItem(PREFERENCES.STORAGE_KEY) ?? '';
    expect(raw).not.toContain('legacy-secret');
    expect(JSON.parse(raw)).toMatchObject({
      email: 'legacy@example.com',
      hasStoredSession: true,
      instance: 'https://speleodb.org',
      projectVisibility: { project: false },
    });
    expect(getToken()).toBe('legacy-secret');
  });

  it('never writes a fresh token into localStorage', async () => {
    const { credentials, getToken } = createCredentialStore();
    const sessions = new SecureSessionStore(credentials, sessionMetadataStore);
    await sessions.initialize();

    await sessions.establish({
      email: 'user@example.com',
      instance: 'https://speleodb.org',
      token: 'new-secret',
    });

    expect(localStorage.getItem(PREFERENCES.STORAGE_KEY)).not.toContain('new-secret');
    expect(getToken()).toBe('new-secret');
  });

  it('clears both native credentials and local session metadata', async () => {
    const { credentials, getToken } = createCredentialStore('secure-token');
    sessionMetadataStore.commit({ instance: 'https://speleodb.org' });
    const sessions = new SecureSessionStore(credentials, sessionMetadataStore);
    await sessions.initialize();

    await sessions.clear();

    expect(getToken()).toBeNull();
    expect(localStorage.getItem(PREFERENCES.STORAGE_KEY)).not.toContain('secure-token');
    expect(sessionMetadataStore.read()).toMatchObject({
      email: undefined,
      hasStoredSession: false,
      legacyToken: undefined,
    });
  });
});
