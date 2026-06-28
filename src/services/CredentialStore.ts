import { Capacitor, registerPlugin } from '@capacitor/core';

const MAX_TOKEN_BYTES = 16 * 1024;

export type CredentialStoreErrorCode =
  | 'invalid-token'
  | 'invalid-response'
  | 'native-only';

export class CredentialStoreError extends Error {
  constructor(
    public readonly code: CredentialStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CredentialStoreError';
  }
}

/** A narrow boundary for the authentication token held by the native secure store. */
export interface CredentialStore {
  readToken(): Promise<string | null>;
  writeToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
}

export interface NativeCredentialStorePlugin {
  readToken(): Promise<{ token: unknown }>;
  writeToken(options: { token: string }): Promise<void>;
  clearToken(): Promise<void>;
}

const NativeCredentialStore = registerPlugin<NativeCredentialStorePlugin>('CredentialStore');

function validateToken(token: string): void {
  const byteLength = new TextEncoder().encode(token).byteLength;
  if (token.trim().length === 0 || byteLength > MAX_TOKEN_BYTES) {
    throw new CredentialStoreError(
      'invalid-token',
      `Authentication tokens must contain 1 to ${MAX_TOKEN_BYTES} UTF-8 bytes`,
    );
  }
}

/**
 * Capacitor adapter for the first-party iOS Keychain and Android Keystore plugin.
 *
 * There is deliberately no browser/localStorage fallback: callers must handle an
 * unavailable native vault explicitly instead of silently weakening storage.
 */
export class CapacitorCredentialStore implements CredentialStore {
  constructor(
    private readonly plugin: NativeCredentialStorePlugin = NativeCredentialStore,
    private readonly isNativePlatform: () => boolean = () => Capacitor.isNativePlatform(),
  ) {}

  async readToken(): Promise<string | null> {
    this.requireNativePlatform();
    const result = await this.plugin.readToken();
    if (result.token === null) return null;
    if (typeof result.token !== 'string') {
      throw new CredentialStoreError(
        'invalid-response',
        'The native credential store returned an invalid response',
      );
    }
    validateToken(result.token);
    return result.token;
  }

  async writeToken(token: string): Promise<void> {
    this.requireNativePlatform();
    validateToken(token);
    await this.plugin.writeToken({ token });
  }

  async clearToken(): Promise<void> {
    this.requireNativePlatform();
    await this.plugin.clearToken();
  }

  private requireNativePlatform(): void {
    if (!this.isNativePlatform()) {
      throw new CredentialStoreError(
        'native-only',
        'Secure credential storage is available only in the native application',
      );
    }
  }
}
