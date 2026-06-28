package org.speleodb.app.security;

public final class CredentialStoreException extends Exception {
    public CredentialStoreException(String message) {
        super(message);
    }

    public CredentialStoreException(String message, Throwable cause) {
        super(message, cause);
    }
}
