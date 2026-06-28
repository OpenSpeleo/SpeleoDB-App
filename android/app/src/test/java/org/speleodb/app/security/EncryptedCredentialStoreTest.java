package org.speleodb.app.security;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.junit.Before;
import org.junit.Test;

import java.security.GeneralSecurityException;
import java.util.Arrays;

import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

public class EncryptedCredentialStoreTest {
    private InMemoryKeyProvider keyProvider;
    private InMemoryPersistence persistence;
    private EncryptedCredentialStore store;

    @Before
    public void setUp() throws Exception {
        keyProvider = new InMemoryKeyProvider();
        persistence = new InMemoryPersistence();
        store = new EncryptedCredentialStore(
            new AesGcmCredentialCipher(keyProvider),
            persistence
        );
    }

    @Test
    public void emptyStoreReturnsNull() throws Exception {
        assertNull(store.readToken());
        assertFalse(keyProvider.created);
    }

    @Test
    public void tokenRoundTripsThroughProductionCipher() throws Exception {
        store.writeToken("unicode-token-é");

        assertEquals("unicode-token-é", store.readToken());
        assertTrue(keyProvider.created);
        assertFalse(
            new String(persistence.encrypted.ciphertext(), java.nio.charset.StandardCharsets.UTF_8)
                .contains("unicode-token")
        );
    }

    @Test
    public void replacingTokenUsesFreshRandomizedCiphertext() throws Exception {
        store.writeToken("same-token");
        byte[] firstIv = persistence.encrypted.initializationVector();
        byte[] firstCiphertext = persistence.encrypted.ciphertext();

        store.writeToken("same-token");

        assertFalse(Arrays.equals(firstIv, persistence.encrypted.initializationVector()));
        assertFalse(Arrays.equals(firstCiphertext, persistence.encrypted.ciphertext()));
        assertEquals("same-token", store.readToken());
    }

    @Test
    public void associatedDataRejectsTamperedCiphertext() throws Exception {
        store.writeToken("token");
        byte[] tampered = persistence.encrypted.ciphertext();
        tampered[tampered.length - 1] ^= 1;
        persistence.encrypted = new EncryptedCredential(
            persistence.encrypted.initializationVector(),
            tampered
        );

        CredentialStoreException error = assertThrows(
            CredentialStoreException.class,
            store::readToken
        );

        assertTrue(error.getMessage().contains("decrypt"));
    }

    @Test
    public void missingKeyCannotDecryptPersistedCredential() throws Exception {
        store.writeToken("token");
        keyProvider.key = null;

        CredentialStoreException error = assertThrows(
            CredentialStoreException.class,
            store::readToken
        );

        assertEquals("The credential encryption key is missing", error.getMessage());
    }

    @Test
    public void clearRemovesCiphertextAndKeyAndIsIdempotent() throws Exception {
        store.writeToken("token");

        store.clearToken();
        store.clearToken();

        assertNull(store.readToken());
        assertNull(persistence.encrypted);
        assertNull(keyProvider.key);
        assertEquals(2, keyProvider.deleteCount);
    }

    @Test
    public void rejectsInvalidTokensBeforeEncryptingOrReplacing() throws Exception {
        store.writeToken("existing");
        EncryptedCredential existing = persistence.encrypted;

        assertThrows(CredentialStoreException.class, () -> store.writeToken(null));
        assertThrows(CredentialStoreException.class, () -> store.writeToken(" \u00a0\n"));
        assertThrows(
            CredentialStoreException.class,
            () -> store.writeToken("x".repeat(EncryptedCredentialStore.MAX_TOKEN_BYTES + 1))
        );

        assertArrayEquals(existing.initializationVector(), persistence.encrypted.initializationVector());
        assertArrayEquals(existing.ciphertext(), persistence.encrypted.ciphertext());
        assertEquals("existing", store.readToken());
    }

    @Test
    public void acceptsMaximumUtf8Length() throws Exception {
        String token = "x".repeat(EncryptedCredentialStore.MAX_TOKEN_BYTES);

        store.writeToken(token);

        assertEquals(token, store.readToken());
    }

    @Test
    public void encryptedCredentialDefensivelyCopiesArrays() {
        byte[] iv = { 1, 2, 3 };
        byte[] ciphertext = { 4, 5, 6 };
        EncryptedCredential encrypted = new EncryptedCredential(iv, ciphertext);

        iv[0] = 9;
        ciphertext[0] = 9;
        byte[] returnedIv = encrypted.initializationVector();
        byte[] returnedCiphertext = encrypted.ciphertext();
        returnedIv[1] = 9;
        returnedCiphertext[1] = 9;

        assertArrayEquals(new byte[] { 1, 2, 3 }, encrypted.initializationVector());
        assertArrayEquals(new byte[] { 4, 5, 6 }, encrypted.ciphertext());
        assertNotEquals(returnedIv[1], encrypted.initializationVector()[1]);
        assertNotEquals(returnedCiphertext[1], encrypted.ciphertext()[1]);
    }

    private static final class InMemoryKeyProvider
        implements AesGcmCredentialCipher.SecretKeyProvider {
        private SecretKey key;
        private boolean created;
        private int deleteCount;

        @Override
        public SecretKey getOrCreate() throws GeneralSecurityException {
            if (key == null) {
                KeyGenerator generator = KeyGenerator.getInstance("AES");
                generator.init(256);
                key = generator.generateKey();
                created = true;
            }
            return key;
        }

        @Override
        public SecretKey getExisting() {
            return key;
        }

        @Override
        public void delete() {
            key = null;
            deleteCount += 1;
        }
    }

    private static final class InMemoryPersistence
        implements EncryptedCredentialStore.Persistence {
        private EncryptedCredential encrypted;

        @Override
        public EncryptedCredential read() {
            return encrypted;
        }

        @Override
        public void replace(EncryptedCredential encrypted) {
            this.encrypted = encrypted;
        }

        @Override
        public void clear() {
            encrypted = null;
        }
    }
}
