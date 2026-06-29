import type { CredentialStore } from './CredentialStore';
import { isAbortError, throwIfAborted } from '../utils/abort';
import { getInstanceBaseUrl } from '../utils/instanceUrl';

export interface StoredSession {
  email?: string;
  instance: string;
  token: string;
}

export interface SessionMetadata {
  email?: string;
  hasStoredSession: boolean;
  instance?: string;
  legacyToken?: string;
}

export interface SessionMetadataStore {
  read(): SessionMetadata;
  commit(session: Omit<StoredSession, 'token'>): void;
  clear(): void;
}

export interface SessionStore {
  initialize(): Promise<StoredSession | null>;
  getSession(): StoredSession | null;
  establish(session: StoredSession, options?: { signal?: AbortSignal }): Promise<void>;
  clear(): Promise<void>;
}

export class SessionStoreError extends Error {
  constructor(
    public readonly code: 'not-initialized' | 'persistence-failed' | 'rollback-failed',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SessionStoreError';
  }
}

function normalizeSession(session: StoredSession): StoredSession {
  const token = session.token.trim();
  const instance = session.instance.trim();
  if (!token || !instance) {
    throw new SessionStoreError(
      'persistence-failed',
      'A valid token and instance are required for a stored session',
    );
  }
  const email = session.email?.trim();
  return { token, instance, ...(email ? { email } : {}) };
}

function normalizeNewSession(session: StoredSession): StoredSession {
  const normalized = normalizeSession(session);
  try {
    return {
      ...normalized,
      instance: getInstanceBaseUrl(normalized.instance),
    };
  } catch (error) {
    throw new SessionStoreError(
      'persistence-failed',
      'A valid SpeleoDB instance origin is required for a stored session',
      { cause: error },
    );
  }
}

/** Coordinates secure token writes with non-secret local session metadata. */
export class SecureSessionStore implements SessionStore {
  private current: StoredSession | null = null;
  private initialized = false;
  private initialization: Promise<StoredSession | null> | null = null;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly credentials: CredentialStore,
    private readonly metadata: SessionMetadataStore,
  ) {}

  initialize(): Promise<StoredSession | null> {
    if (this.initialization) return this.initialization;
    this.initialization = this.initializeOnce();
    return this.initialization;
  }

  getSession(): StoredSession | null {
    if (!this.initialized) {
      throw new SessionStoreError(
        'not-initialized',
        'Secure session storage must be initialized before use',
      );
    }
    return this.current ? { ...this.current } : null;
  }

  async establish(
    session: StoredSession,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    this.assertInitialized();
    const normalized = normalizeNewSession(session);
    await this.serializeMutation(() => this.establishOnce(normalized, options));
  }

  async clear(): Promise<void> {
    this.assertInitialized();
    await this.serializeMutation(() => this.clearOnce());
  }

  private async establishOnce(
    normalized: StoredSession,
    options: { signal?: AbortSignal },
  ): Promise<void> {
    const previousSession = this.current ? { ...this.current } : null;
    throwIfAborted(options.signal);
    const previousToken = await this.credentials.readToken();
    throwIfAborted(options.signal);

    await this.credentials.writeToken(normalized.token);
    let metadataTouched = false;
    try {
      throwIfAborted(options.signal);
      metadataTouched = true;
      this.metadata.commit({
        email: normalized.email,
        instance: normalized.instance,
      });
      throwIfAborted(options.signal);
    } catch (error) {
      await this.rollbackEstablishedSession(
        previousSession,
        previousToken,
        metadataTouched,
        error,
      );
      if (isAbortError(error)) throw error;
      throw new SessionStoreError(
        'persistence-failed',
        'Unable to persist secure session metadata',
        { cause: error },
      );
    }
    this.current = normalized;
  }

  private async clearOnce(): Promise<void> {
    this.current = null;
    const failures: unknown[] = [];
    try {
      await this.credentials.clearToken();
    } catch (error) {
      failures.push(error);
    }
    try {
      this.metadata.clear();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) {
      throw new SessionStoreError(
        'persistence-failed',
        'Unable to completely remove the secure session',
        {
          cause: failures.length === 1
            ? failures[0]
            : new AggregateError(failures),
        },
      );
    }
  }

  private serializeMutation<T>(mutate: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(mutate);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async initializeOnce(): Promise<StoredSession | null> {
    try {
      const metadata = this.metadata.read();
      const secureToken = await this.credentials.readToken();
      const legacyToken = metadata.legacyToken?.trim();
      const instance = metadata.instance?.trim();

      if (legacyToken && instance) {
        const migrated = normalizeSession({
          email: metadata.email,
          instance,
          token: legacyToken,
        });
        await this.migrateLegacySession(migrated, secureToken);
        this.current = migrated;
        return { ...migrated };
      }

      if (metadata.hasStoredSession && instance && secureToken) {
        const restored = normalizeSession({
          email: metadata.email,
          instance,
          token: secureToken,
        });
        this.current = restored;
        return { ...restored };
      }

      if (secureToken) {
        await this.credentials.clearToken();
      }
      if (metadata.hasStoredSession || metadata.legacyToken) {
        this.metadata.clear();
      }
      this.current = null;
      return null;
    } finally {
      this.initialized = true;
    }
  }

  private async migrateLegacySession(
    session: StoredSession,
    previousToken: string | null,
  ): Promise<void> {
    if (previousToken !== session.token) {
      await this.credentials.writeToken(session.token);
    }
    try {
      this.metadata.commit({ email: session.email, instance: session.instance });
    } catch (error) {
      if (previousToken !== session.token) {
        await this.rollbackCredential(previousToken, error);
      }
      throw new SessionStoreError(
        'persistence-failed',
        'Unable to remove the legacy session token',
        { cause: error },
      );
    }
  }

  private async rollbackCredential(previousToken: string | null, cause: unknown): Promise<void> {
    try {
      if (previousToken === null) {
        await this.credentials.clearToken();
      } else {
        await this.credentials.writeToken(previousToken);
      }
    } catch (rollbackError) {
      throw new SessionStoreError(
        'rollback-failed',
        'Secure session rollback failed',
        { cause: new AggregateError([cause, rollbackError]) },
      );
    }
  }

  private async rollbackEstablishedSession(
    previousSession: StoredSession | null,
    previousToken: string | null,
    restoreMetadata: boolean,
    cause: unknown,
  ): Promise<void> {
    try {
      if (previousToken === null) {
        await this.credentials.clearToken();
      } else {
        await this.credentials.writeToken(previousToken);
      }
      if (restoreMetadata) {
        if (previousSession) {
          this.metadata.commit({
            email: previousSession.email,
            instance: previousSession.instance,
          });
        } else {
          this.metadata.clear();
        }
      }
      this.current = previousSession;
    } catch (rollbackError) {
      throw new SessionStoreError(
        'rollback-failed',
        'Secure session rollback failed',
        { cause: new AggregateError([cause, rollbackError]) },
      );
    }
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new SessionStoreError(
        'not-initialized',
        'Secure session storage must be initialized before use',
      );
    }
  }
}
