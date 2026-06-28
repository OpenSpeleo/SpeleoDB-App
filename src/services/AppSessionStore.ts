import { Capacitor } from '@capacitor/core';

import { CapacitorCredentialStore, type CredentialStore } from './CredentialStore';
import { sessionMetadataStore } from './PreferencesService';
import {
  SecureSessionStore,
  type SessionMetadata,
  type SessionMetadataStore,
  type SessionStore,
} from './SecureSessionStore';

function createVolatileSessionStore(): SessionStore {
  let token: string | null = null;
  let metadata: SessionMetadata = { hasStoredSession: false };
  const credentials: CredentialStore = {
    readToken: async () => token,
    writeToken: async (next) => { token = next; },
    clearToken: async () => { token = null; },
  };
  const volatileMetadata: SessionMetadataStore = {
    read: () => ({ ...metadata }),
    commit: (session) => {
      metadata = { ...session, hasStoredSession: true };
    },
    clear: () => {
      metadata = { hasStoredSession: false };
    },
  };
  return new SecureSessionStore(credentials, volatileMetadata);
}

export function createAppSessionStore(
  isNativePlatform: () => boolean = () => Capacitor.isNativePlatform(),
  nativeCredentials: CredentialStore = new CapacitorCredentialStore(),
): SessionStore {
  if (!isNativePlatform()) return createVolatileSessionStore();
  return new SecureSessionStore(nativeCredentials, sessionMetadataStore);
}

export const appSessionStore = createAppSessionStore();
