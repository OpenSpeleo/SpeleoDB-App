# Credential and session storage

## Security boundary

Authentication tokens belong only in the first-party native credential store:

- iOS stores the token as a generic-password Keychain item using
  `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. The item is available to
  background work after the first device unlock, is not synchronized, and does
  not migrate to another device backup.
- Android encrypts the token with randomized AES-256-GCM. The non-exportable key
  is held by Android Keystore and the ciphertext plus initialization vector are
  committed together to app-private preferences. Associated data binds the
  ciphertext to the SpeleoDB credential schema. That preference file is
  excluded from cloud backup and device transfer because its Keystore key is
  deliberately non-exportable.

The JavaScript `CredentialStore` contract is deliberately limited to one fixed
authentication token. It does not expose arbitrary key/value storage, and it
has no browser or `localStorage` fallback. Values must contain between 1 and
16,384 UTF-8 bytes. Reads fail closed when ciphertext, Keychain data, or the
native response is malformed.

Capacitor native logging is disabled because bridge debug logs include plugin
arguments. Native store failures return stable error codes and never include
tokens, ciphertext, coordinates, or operating-system error details.

## Lifecycle and ownership

`CapacitorCredentialStore` owns the TypeScript/native boundary. The iOS plugin
is registered by `AppBridgeViewController`; the Android plugin is registered by
`MainActivity`. Native cryptography and persistence remain behind platform
store implementations so session coordination does not depend on Security or
Android Keystore APIs.

`SecureSessionStore` combines that vault with non-secret metadata from
`PreferencesService`. Application bootstrap initializes it before React mounts;
the controller then reads credentials only from its in-memory secure-session
snapshot. Preferences contain `instance`, optional `email`, and
`hasStoredSession`, never a newly written token.

Non-native browser development uses a separate volatile instance of the same
coordinator. Its credential and metadata adapters exist only in memory, so
login remains testable without weakening the native persistence boundary and
reload always returns to an unauthenticated state.

Legacy upgrades are transactional:

1. Read the legacy token without exposing it through `getPreferences()`.
2. Write it to the native vault.
3. Rewrite preferences with the token removed and the session marker set.

If step 3 fails, the prior vault value is restored. A matching vault value from
an interrupted attempt is reused without rewriting. Orphaned vault values,
incomplete metadata, and malformed responses fail closed. Scrubbing invalid
session metadata preserves unrelated map and UI preferences. Fresh login and
account replacement use the same secure-first ordering and rollback contract.

## Verification

- TypeScript contract tests prove native-only fail-closed behavior, response
  validation, byte limits, and exact single-call semantics.
- Session tests prove commit ordering, legacy and interrupted migration,
  rollback to empty and prior vault states, rollback failure reporting, orphan
  cleanup, account replacement, and destructive logout semantics.
- Android unit tests exercise the production AES-GCM implementation, randomized
  encryption, authentication-tag failure, missing keys, replacement, clearing,
  and token bounds.
- iOS Keychain tests exercise empty reads, replacement, clearing, byte limits,
  and malformed stored data on a simulator Keychain.
- Every native change requires Android unit/release compilation and an iOS
  simulator test/release build in addition to the complete web CI gate.
