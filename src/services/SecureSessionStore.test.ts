import { describe, expect, it, vi } from 'vitest';

import type { CredentialStore } from './CredentialStore';
import {
  SecureSessionStore,
  SessionStoreError,
  type SessionMetadata,
  type SessionMetadataStore,
} from './SecureSessionStore';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createHarness(options: {
  metadata?: Partial<SessionMetadata>;
  secureToken?: string | null;
} = {}) {
  let secureToken = options.secureToken ?? null;
  let metadata: SessionMetadata = {
    hasStoredSession: false,
    ...options.metadata,
  };
  const credentials: CredentialStore = {
    readToken: vi.fn(async () => secureToken),
    writeToken: vi.fn(async (token: string) => { secureToken = token; }),
    clearToken: vi.fn(async () => { secureToken = null; }),
  };
  const metadataStore: SessionMetadataStore = {
    read: vi.fn(() => ({ ...metadata })),
    commit: vi.fn((session) => {
      metadata = { ...session, hasStoredSession: true };
    }),
    clear: vi.fn(() => {
      metadata = { hasStoredSession: false };
    }),
  };
  const store = new SecureSessionStore(credentials, metadataStore);

  return {
    credentials,
    getMetadata: () => ({ ...metadata }),
    getSecureToken: () => secureToken,
    metadataStore,
    store,
  };
}

describe('SecureSessionStore', () => {
  it('requires initialization before synchronous reads and mutations', async () => {
    const { store } = createHarness();

    expect(() => store.getSession()).toThrow(SessionStoreError);
    await expect(store.establish({ instance: 'https://speleodb.org', token: 't' }))
      .rejects.toMatchObject({ code: 'not-initialized' });
    await expect(store.clear()).rejects.toMatchObject({ code: 'not-initialized' });
  });

  it('restores a secure session from non-secret metadata', async () => {
    const { credentials, store } = createHarness({
      secureToken: ' secure-token ',
      metadata: {
        email: ' user@example.com ',
        hasStoredSession: true,
        instance: ' https://speleodb.org ',
      },
    });

    await expect(store.initialize()).resolves.toEqual({
      email: 'user@example.com',
      instance: 'https://speleodb.org',
      token: 'secure-token',
    });
    expect(store.getSession()).toEqual({
      email: 'user@example.com',
      instance: 'https://speleodb.org',
      token: 'secure-token',
    });
    expect(credentials.writeToken).not.toHaveBeenCalled();
  });

  it('shares one initialization across concurrent callers', async () => {
    const { credentials, store } = createHarness();

    const first = store.initialize();
    const second = store.initialize();

    expect(first).toBe(second);
    await expect(Promise.all([first, second])).resolves.toEqual([null, null]);
    expect(credentials.readToken).toHaveBeenCalledOnce();
  });

  it('migrates a legacy token before removing it from metadata', async () => {
    const { credentials, getMetadata, getSecureToken, metadataStore, store } = createHarness({
      metadata: {
        email: 'legacy@example.com',
        instance: 'https://speleodb.org',
        legacyToken: 'legacy-token',
      },
    });

    await store.initialize();

    expect(credentials.writeToken).toHaveBeenCalledWith('legacy-token');
    expect(vi.mocked(credentials.writeToken).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(metadataStore.commit).mock.invocationCallOrder[0]);
    expect(getSecureToken()).toBe('legacy-token');
    expect(getMetadata()).toEqual({
      email: 'legacy@example.com',
      hasStoredSession: true,
      instance: 'https://speleodb.org',
    });
  });

  it('does not rewrite a secure token when resuming an interrupted migration', async () => {
    const { credentials, store } = createHarness({
      secureToken: 'same-token',
      metadata: {
        instance: 'https://speleodb.org',
        legacyToken: 'same-token',
      },
    });

    await store.initialize();

    expect(credentials.writeToken).not.toHaveBeenCalled();
  });

  it('preserves an already-migrated token when legacy metadata cleanup fails', async () => {
    const { credentials, getSecureToken, metadataStore, store } = createHarness({
      secureToken: 'same-token',
      metadata: {
        instance: 'https://speleodb.org',
        legacyToken: 'same-token',
      },
    });
    vi.mocked(metadataStore.commit).mockImplementationOnce(() => {
      throw new Error('quota');
    });

    await expect(store.initialize()).rejects.toMatchObject({ code: 'persistence-failed' });

    expect(credentials.writeToken).not.toHaveBeenCalled();
    expect(credentials.clearToken).not.toHaveBeenCalled();
    expect(getSecureToken()).toBe('same-token');
  });

  it('rolls back a new secure token when legacy metadata cannot be scrubbed', async () => {
    const { credentials, getSecureToken, metadataStore, store } = createHarness({
      metadata: {
        instance: 'https://speleodb.org',
        legacyToken: 'legacy-token',
      },
    });
    vi.mocked(metadataStore.commit).mockImplementationOnce(() => {
      throw new Error('quota');
    });

    await expect(store.initialize()).rejects.toMatchObject({ code: 'persistence-failed' });

    expect(credentials.clearToken).toHaveBeenCalledOnce();
    expect(getSecureToken()).toBeNull();
    expect(store.getSession()).toBeNull();
  });

  it('restores a previous secure token when migration metadata fails', async () => {
    const { credentials, getSecureToken, metadataStore, store } = createHarness({
      secureToken: 'previous-token',
      metadata: {
        instance: 'https://speleodb.org',
        legacyToken: 'legacy-token',
      },
    });
    vi.mocked(metadataStore.commit).mockImplementationOnce(() => {
      throw new Error('quota');
    });

    await expect(store.initialize()).rejects.toMatchObject({ code: 'persistence-failed' });

    expect(credentials.writeToken).toHaveBeenNthCalledWith(1, 'legacy-token');
    expect(credentials.writeToken).toHaveBeenNthCalledWith(2, 'previous-token');
    expect(getSecureToken()).toBe('previous-token');
  });

  it('reports rollback failure without hiding the original failure', async () => {
    const { credentials, metadataStore, store } = createHarness({
      metadata: {
        instance: 'https://speleodb.org',
        legacyToken: 'legacy-token',
      },
    });
    vi.mocked(metadataStore.commit).mockImplementationOnce(() => {
      throw new Error('quota');
    });
    vi.mocked(credentials.clearToken).mockRejectedValueOnce(new Error('vault failure'));

    await expect(store.initialize()).rejects.toMatchObject({ code: 'rollback-failed' });
  });

  it('clears orphaned secure credentials that have no session metadata', async () => {
    const { credentials, store } = createHarness({ secureToken: 'orphan' });

    await expect(store.initialize()).resolves.toBeNull();

    expect(credentials.clearToken).toHaveBeenCalledOnce();
  });

  it.each([
    { hasStoredSession: true },
    { hasStoredSession: false, legacyToken: 'token-without-instance' },
  ])('clears invalid session metadata: %j', async (metadata) => {
    const { metadataStore, store } = createHarness({ metadata });

    await expect(store.initialize()).resolves.toBeNull();

    expect(metadataStore.clear).toHaveBeenCalledOnce();
  });

  it('establishes a new session with the secure token committed first', async () => {
    const { credentials, getMetadata, metadataStore, store } = createHarness();
    await store.initialize();

    await store.establish({
      email: ' user@example.com ',
      instance: ' https://speleodb.org ',
      token: ' token ',
    });

    expect(credentials.writeToken).toHaveBeenCalledWith('token');
    expect(vi.mocked(credentials.writeToken).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(metadataStore.commit).mock.invocationCallOrder[0]);
    expect(getMetadata()).toEqual({
      email: 'user@example.com',
      hasStoredSession: true,
      instance: 'https://speleodb.org',
    });
    expect(store.getSession()).toEqual({
      email: 'user@example.com',
      instance: 'https://speleodb.org',
      token: 'token',
    });
  });

  it('canonicalizes a recoverable instance before committing a new session', async () => {
    const { getMetadata, store } = createHarness();
    await store.initialize();

    await store.establish({
      instance: ' EXAMPLE.com/// ',
      token: 'token',
    });

    expect(getMetadata()).toEqual({
      hasStoredSession: true,
      instance: 'https://example.com',
    });
    expect(store.getSession()?.instance).toBe('https://example.com');
  });

  it('restores the previous token when cancellation wins during a secure write', async () => {
    const { credentials, getMetadata, getSecureToken, store } = createHarness({
      secureToken: 'old-token',
      metadata: {
        email: 'old@example.com',
        hasStoredSession: true,
        instance: 'https://old.example',
      },
    });
    await store.initialize();
    const abortController = new AbortController();
    const writeToken = vi.mocked(credentials.writeToken).getMockImplementation();
    vi.mocked(credentials.writeToken).mockImplementationOnce(async (token) => {
      await writeToken?.(token);
      abortController.abort();
    });

    await expect(store.establish({
      email: 'new@example.com',
      instance: 'https://new.example',
      token: 'new-token',
    }, { signal: abortController.signal })).rejects.toMatchObject({ name: 'AbortError' });

    expect(credentials.writeToken).toHaveBeenNthCalledWith(1, 'new-token');
    expect(credentials.writeToken).toHaveBeenNthCalledWith(2, 'old-token');
    expect(getSecureToken()).toBe('old-token');
    expect(getMetadata()).toEqual({
      email: 'old@example.com',
      hasStoredSession: true,
      instance: 'https://old.example',
    });
    expect(store.getSession()).toEqual({
      email: 'old@example.com',
      instance: 'https://old.example',
      token: 'old-token',
    });
  });

  it('restores previous token and metadata when cancellation wins after metadata commit', async () => {
    const { getMetadata, getSecureToken, metadataStore, store } = createHarness({
      secureToken: 'old-token',
      metadata: {
        email: 'old@example.com',
        hasStoredSession: true,
        instance: 'https://old.example',
      },
    });
    await store.initialize();
    const abortController = new AbortController();
    const commit = vi.mocked(metadataStore.commit).getMockImplementation();
    vi.mocked(metadataStore.commit).mockImplementationOnce((session) => {
      commit?.(session);
      abortController.abort();
    });

    await expect(store.establish({
      email: 'new@example.com',
      instance: 'https://new.example',
      token: 'new-token',
    }, { signal: abortController.signal })).rejects.toMatchObject({ name: 'AbortError' });

    expect(getSecureToken()).toBe('old-token');
    expect(getMetadata()).toEqual({
      email: 'old@example.com',
      hasStoredSession: true,
      instance: 'https://old.example',
    });
    expect(store.getSession()).toEqual({
      email: 'old@example.com',
      instance: 'https://old.example',
      token: 'old-token',
    });
  });

  it('removes a superseded first session after its metadata was committed', async () => {
    const { getMetadata, getSecureToken, metadataStore, store } = createHarness();
    await store.initialize();
    const abortController = new AbortController();
    const commit = vi.mocked(metadataStore.commit).getMockImplementation();
    vi.mocked(metadataStore.commit).mockImplementationOnce((session) => {
      commit?.(session);
      abortController.abort();
    });

    await expect(store.establish({
      instance: 'https://new.example',
      token: 'new-token',
    }, { signal: abortController.signal })).rejects.toMatchObject({ name: 'AbortError' });

    expect(getSecureToken()).toBeNull();
    expect(getMetadata()).toEqual({ hasStoredSession: false });
    expect(store.getSession()).toBeNull();
  });

  it('reports a failed cancellation rollback without accepting the new session', async () => {
    const { credentials, metadataStore, store } = createHarness();
    await store.initialize();
    const abortController = new AbortController();
    const commit = vi.mocked(metadataStore.commit).getMockImplementation();
    vi.mocked(metadataStore.commit).mockImplementationOnce((session) => {
      commit?.(session);
      abortController.abort();
    });
    vi.mocked(credentials.clearToken).mockRejectedValueOnce(new Error('vault failure'));

    await expect(store.establish({
      instance: 'https://new.example',
      token: 'new-token',
    }, { signal: abortController.signal })).rejects.toMatchObject({
      code: 'rollback-failed',
    });

    expect(store.getSession()).toBeNull();
  });

  it('waits for an aborted establishment rollback before clearing the session', async () => {
    const { credentials, getMetadata, getSecureToken, metadataStore, store } = createHarness({
      secureToken: 'old-token',
      metadata: {
        hasStoredSession: true,
        instance: 'https://old.example',
      },
    });
    await store.initialize();
    const writeRelease = createDeferred<void>();
    const writeToken = vi.mocked(credentials.writeToken).getMockImplementation();
    vi.mocked(credentials.writeToken).mockImplementationOnce(async (token) => {
      await writeToken?.(token);
      await writeRelease.promise;
    });
    const abortController = new AbortController();

    const establish = store.establish({
      instance: 'https://new.example',
      token: 'new-token',
    }, { signal: abortController.signal });
    await vi.waitFor(() => expect(credentials.writeToken).toHaveBeenCalledWith('new-token'));
    abortController.abort();
    const clear = store.clear();

    expect(credentials.clearToken).not.toHaveBeenCalled();
    expect(metadataStore.clear).not.toHaveBeenCalled();
    writeRelease.resolve();
    await expect(establish).rejects.toMatchObject({ name: 'AbortError' });
    await expect(clear).resolves.toBeUndefined();

    expect(credentials.writeToken).toHaveBeenNthCalledWith(2, 'old-token');
    expect(credentials.clearToken).toHaveBeenCalledOnce();
    expect(getSecureToken()).toBeNull();
    expect(getMetadata()).toEqual({ hasStoredSession: false });
    expect(store.getSession()).toBeNull();
  });

  it.each([
    { instance: '', token: 'token' },
    { instance: 'https://speleodb.org', token: ' ' },
    { instance: 'https://speleodb.org/tenant', token: 'token' },
    { instance: 'https://user:secret@speleodb.org', token: 'token' },
  ])('rejects invalid new session %j before touching storage', async (session) => {
    const { credentials, metadataStore, store } = createHarness();
    await store.initialize();
    vi.clearAllMocks();

    await expect(store.establish(session)).rejects.toMatchObject({
      code: 'persistence-failed',
    });

    expect(credentials.writeToken).not.toHaveBeenCalled();
    expect(metadataStore.commit).not.toHaveBeenCalled();
  });

  it('rolls back session replacement when metadata commit fails', async () => {
    const { credentials, getSecureToken, metadataStore, store } = createHarness({
      secureToken: 'old-token',
      metadata: {
        hasStoredSession: true,
        instance: 'https://old.example',
      },
    });
    await store.initialize();
    vi.mocked(metadataStore.commit).mockImplementationOnce(() => {
      throw new Error('quota');
    });

    await expect(store.establish({
      instance: 'https://new.example',
      token: 'new-token',
    })).rejects.toMatchObject({ code: 'persistence-failed' });

    expect(credentials.writeToken).toHaveBeenNthCalledWith(1, 'new-token');
    expect(credentials.writeToken).toHaveBeenNthCalledWith(2, 'old-token');
    expect(getSecureToken()).toBe('old-token');
    expect(store.getSession()?.instance).toBe('https://old.example');
  });

  it('clears the secure token before deleting session metadata', async () => {
    const { credentials, getMetadata, metadataStore, store } = createHarness({
      secureToken: 'token',
      metadata: { hasStoredSession: true, instance: 'https://speleodb.org' },
    });
    await store.initialize();

    await store.clear();

    expect(credentials.clearToken).toHaveBeenCalledOnce();
    expect(metadataStore.clear).toHaveBeenCalledOnce();
    expect(getMetadata()).toEqual({ hasStoredSession: false });
    expect(store.getSession()).toBeNull();
  });

  it('revokes metadata and cannot restore the session when secure-token deletion fails', async () => {
    const { credentials, getMetadata, metadataStore, store } = createHarness({
      secureToken: 'token',
      metadata: { hasStoredSession: true, instance: 'https://speleodb.org' },
    });
    await store.initialize();
    vi.mocked(credentials.clearToken).mockRejectedValueOnce(new Error('vault failure'));

    await expect(store.clear()).rejects.toMatchObject({ code: 'persistence-failed' });

    expect(metadataStore.clear).toHaveBeenCalledOnce();
    expect(getMetadata()).toEqual({ hasStoredSession: false });
    expect(store.getSession()).toBeNull();

    const restartedStore = new SecureSessionStore(credentials, metadataStore);
    await expect(restartedStore.initialize()).resolves.toBeNull();
    expect(credentials.clearToken).toHaveBeenCalledTimes(2);
  });

  it('fails closed in memory when metadata deletion fails after token deletion', async () => {
    const { metadataStore, store } = createHarness({
      secureToken: 'token',
      metadata: { hasStoredSession: true, instance: 'https://speleodb.org' },
    });
    await store.initialize();
    vi.mocked(metadataStore.clear).mockImplementationOnce(() => {
      throw new Error('storage failure');
    });

    await expect(store.clear()).rejects.toMatchObject({ code: 'persistence-failed' });

    expect(store.getSession()).toBeNull();
  });

  it('aggregates token and metadata deletion failures after revoking memory', async () => {
    const { credentials, metadataStore, store } = createHarness({
      secureToken: 'token',
      metadata: { hasStoredSession: true, instance: 'https://speleodb.org' },
    });
    await store.initialize();
    vi.mocked(credentials.clearToken).mockRejectedValueOnce(new Error('vault failure'));
    vi.mocked(metadataStore.clear).mockImplementationOnce(() => {
      throw new Error('metadata failure');
    });

    await expect(store.clear()).rejects.toMatchObject({
      code: 'persistence-failed',
      cause: expect.any(AggregateError),
    });
    expect(store.getSession()).toBeNull();
  });

  it('marks initialization complete but stays signed out after a metadata read failure', async () => {
    const { metadataStore, store } = createHarness();
    vi.mocked(metadataStore.read).mockImplementationOnce(() => {
      throw new Error('corrupt storage');
    });

    await expect(store.initialize()).rejects.toThrow('corrupt storage');

    expect(store.getSession()).toBeNull();
  });
});
