package org.speleodb.app.security;

import androidx.annotation.Nullable;

import java.nio.charset.StandardCharsets;

final class EncryptedCredentialStore implements CredentialStore {
    interface Persistence {
        @Nullable
        EncryptedCredential read() throws CredentialStoreException;

        void replace(EncryptedCredential encrypted) throws CredentialStoreException;

        void clear() throws CredentialStoreException;
    }

    static final int MAX_TOKEN_BYTES = 16 * 1024;

    private final AesGcmCredentialCipher cipher;
    private final Persistence persistence;

    EncryptedCredentialStore(AesGcmCredentialCipher cipher, Persistence persistence) {
        this.cipher = cipher;
        this.persistence = persistence;
    }

    @Override
    @Nullable
    public synchronized String readToken() throws CredentialStoreException {
        EncryptedCredential encrypted = persistence.read();
        if (encrypted == null) {
            return null;
        }
        String token = cipher.decrypt(encrypted);
        validateToken(token);
        return token;
    }

    @Override
    public synchronized void writeToken(String token) throws CredentialStoreException {
        validateToken(token);
        persistence.replace(cipher.encrypt(token));
    }

    @Override
    public synchronized void clearToken() throws CredentialStoreException {
        persistence.clear();
        cipher.deleteKey();
    }

    private static void validateToken(String token) throws CredentialStoreException {
        if (token == null) {
            throw new CredentialStoreException("An authentication token is required");
        }
        int byteLength = token.getBytes(StandardCharsets.UTF_8).length;
        boolean containsContent = token.codePoints().anyMatch(
            codePoint -> !Character.isWhitespace(codePoint) && !Character.isSpaceChar(codePoint)
        );
        if (!containsContent || byteLength > MAX_TOKEN_BYTES) {
            throw new CredentialStoreException(
                "Authentication tokens must contain 1 to " + MAX_TOKEN_BYTES + " UTF-8 bytes"
            );
        }
    }
}
