package org.speleodb.app.security;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class AesGcmCredentialCipher {
    interface SecretKeyProvider {
        SecretKey getOrCreate() throws GeneralSecurityException;

        SecretKey getExisting() throws GeneralSecurityException;

        void delete() throws GeneralSecurityException;
    }

    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int AUTH_TAG_BITS = 128;
    private static final byte[] ASSOCIATED_DATA =
        "org.speleodb.app.credentials.v1".getBytes(StandardCharsets.UTF_8);

    private final SecretKeyProvider keyProvider;

    AesGcmCredentialCipher(SecretKeyProvider keyProvider) {
        this.keyProvider = keyProvider;
    }

    EncryptedCredential encrypt(String token) throws CredentialStoreException {
        byte[] plaintext = token.getBytes(StandardCharsets.UTF_8);
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, keyProvider.getOrCreate());
            cipher.updateAAD(ASSOCIATED_DATA);
            return new EncryptedCredential(cipher.getIV(), cipher.doFinal(plaintext));
        } catch (GeneralSecurityException error) {
            throw new CredentialStoreException("Unable to encrypt the credential", error);
        } finally {
            Arrays.fill(plaintext, (byte) 0);
        }
    }

    String decrypt(EncryptedCredential encrypted) throws CredentialStoreException {
        byte[] plaintext = null;
        try {
            SecretKey key = keyProvider.getExisting();
            if (key == null) {
                throw new CredentialStoreException("The credential encryption key is missing");
            }
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(
                Cipher.DECRYPT_MODE,
                key,
                new GCMParameterSpec(AUTH_TAG_BITS, encrypted.initializationVector())
            );
            cipher.updateAAD(ASSOCIATED_DATA);
            plaintext = cipher.doFinal(encrypted.ciphertext());
            return new String(plaintext, StandardCharsets.UTF_8);
        } catch (CredentialStoreException error) {
            throw error;
        } catch (GeneralSecurityException error) {
            throw new CredentialStoreException("Unable to decrypt the credential", error);
        } finally {
            if (plaintext != null) {
                Arrays.fill(plaintext, (byte) 0);
            }
        }
    }

    void deleteKey() throws CredentialStoreException {
        try {
            keyProvider.delete();
        } catch (GeneralSecurityException error) {
            throw new CredentialStoreException("Unable to delete the credential key", error);
        }
    }
}
