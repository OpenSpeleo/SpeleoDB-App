package org.speleodb.app.security;

import androidx.annotation.Nullable;

public interface CredentialStore {
    @Nullable
    String readToken() throws CredentialStoreException;

    void writeToken(String token) throws CredentialStoreException;

    void clearToken() throws CredentialStoreException;
}
