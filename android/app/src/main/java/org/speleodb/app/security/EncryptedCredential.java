package org.speleodb.app.security;

import java.util.Arrays;

final class EncryptedCredential {
    private final byte[] initializationVector;
    private final byte[] ciphertext;

    EncryptedCredential(byte[] initializationVector, byte[] ciphertext) {
        this.initializationVector = Arrays.copyOf(initializationVector, initializationVector.length);
        this.ciphertext = Arrays.copyOf(ciphertext, ciphertext.length);
    }

    byte[] initializationVector() {
        return Arrays.copyOf(initializationVector, initializationVector.length);
    }

    byte[] ciphertext() {
        return Arrays.copyOf(ciphertext, ciphertext.length);
    }
}
