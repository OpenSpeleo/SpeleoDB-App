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

This boundary is intentionally introduced before session migration. Until the
session migration change lands, existing authentication behavior remains
unchanged and the secure store is unused by the controller.

## Verification

- TypeScript contract tests prove native-only fail-closed behavior, response
  validation, byte limits, and exact single-call semantics.
- Android unit tests exercise the production AES-GCM implementation, randomized
  encryption, authentication-tag failure, missing keys, replacement, clearing,
  and token bounds.
- iOS Keychain tests exercise empty reads, replacement, clearing, byte limits,
  and malformed stored data on a simulator Keychain.
- Every native change requires Android unit/release compilation and an iOS
  simulator test/release build in addition to the complete web CI gate.
