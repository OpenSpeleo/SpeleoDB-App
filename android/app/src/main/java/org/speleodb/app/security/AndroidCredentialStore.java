package org.speleodb.app.security;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.Nullable;

import java.io.IOException;
import java.security.GeneralSecurityException;
import java.security.KeyStore;

import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

public final class AndroidCredentialStore {
    private static final String ANDROID_KEY_STORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "org.speleodb.app.credentials.v1";
    private static final String PREFERENCES_NAME = "speleodb_secure_credentials";
    private static final String IV_KEY = "token_iv";
    private static final String CIPHERTEXT_KEY = "token_ciphertext";

    private AndroidCredentialStore() {}

    public static CredentialStore create(Context context) {
        AesGcmCredentialCipher cipher = new AesGcmCredentialCipher(new AndroidSecretKeyProvider());
        SharedPreferences preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
        return new EncryptedCredentialStore(cipher, new SharedPreferencesPersistence(preferences));
    }

    private static final class AndroidSecretKeyProvider
        implements AesGcmCredentialCipher.SecretKeyProvider {
        @Override
        public SecretKey getOrCreate() throws GeneralSecurityException {
            SecretKey existing = getExisting();
            if (existing != null) {
                return existing;
            }
            KeyGenerator generator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                ANDROID_KEY_STORE
            );
            generator.init(
                new KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true)
                    .build()
            );
            return generator.generateKey();
        }

        @Override
        @Nullable
        public SecretKey getExisting() throws GeneralSecurityException {
            KeyStore keyStore = loadKeyStore();
            return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        }

        @Override
        public void delete() throws GeneralSecurityException {
            KeyStore keyStore = loadKeyStore();
            if (keyStore.containsAlias(KEY_ALIAS)) {
                keyStore.deleteEntry(KEY_ALIAS);
            }
        }

        private KeyStore loadKeyStore() throws GeneralSecurityException {
            KeyStore keyStore = KeyStore.getInstance(ANDROID_KEY_STORE);
            try {
                keyStore.load(null);
                return keyStore;
            } catch (IOException error) {
                throw new GeneralSecurityException("Unable to load Android Keystore", error);
            }
        }
    }

    private static final class SharedPreferencesPersistence
        implements EncryptedCredentialStore.Persistence {
        private final SharedPreferences preferences;

        SharedPreferencesPersistence(SharedPreferences preferences) {
            this.preferences = preferences;
        }

        @Override
        @Nullable
        public EncryptedCredential read() throws CredentialStoreException {
            boolean hasIv = preferences.contains(IV_KEY);
            boolean hasCiphertext = preferences.contains(CIPHERTEXT_KEY);
            if (!hasIv && !hasCiphertext) {
                return null;
            }
            if (!hasIv || !hasCiphertext) {
                throw new CredentialStoreException("The encrypted credential is incomplete");
            }
            try {
                byte[] iv = Base64.decode(preferences.getString(IV_KEY, ""), Base64.NO_WRAP);
                byte[] ciphertext = Base64.decode(
                    preferences.getString(CIPHERTEXT_KEY, ""),
                    Base64.NO_WRAP
                );
                if (iv.length == 0 || ciphertext.length == 0) {
                    throw new CredentialStoreException("The encrypted credential is empty");
                }
                return new EncryptedCredential(iv, ciphertext);
            } catch (IllegalArgumentException error) {
                throw new CredentialStoreException("The encrypted credential is malformed", error);
            }
        }

        @Override
        public void replace(EncryptedCredential encrypted) throws CredentialStoreException {
            boolean committed = preferences.edit()
                .putString(IV_KEY, Base64.encodeToString(encrypted.initializationVector(), Base64.NO_WRAP))
                .putString(
                    CIPHERTEXT_KEY,
                    Base64.encodeToString(encrypted.ciphertext(), Base64.NO_WRAP)
                )
                .commit();
            if (!committed) {
                throw new CredentialStoreException("Unable to persist the encrypted credential");
            }
        }

        @Override
        public void clear() throws CredentialStoreException {
            if (!preferences.edit().clear().commit()) {
                throw new CredentialStoreException("Unable to clear the encrypted credential");
            }
        }
    }
}
