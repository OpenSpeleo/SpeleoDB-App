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
  ciphertext to the SpeleoDB credential schema. That preference file is excluded
  from cloud backup and device transfer because its Keystore key is deliberately
  non-exportable.

The JavaScript `CredentialStore` contract is deliberately limited to one fixed
authentication token. It does not expose arbitrary key/value storage, and it has
no browser or `localStorage` fallback. Values must contain between 1 and 16,384
UTF-8 bytes. Reads fail closed when ciphertext, Keychain data, or the native
response is malformed.

## Transport and redirect boundary

Release requests are HTTPS-only. Remote instance values entered with `http://`
are upgraded to HTTPS, while HTTP loopback is permitted only in development.
Request URLs with embedded username/password values and non-HTTP schemes are
rejected before either transport runs. Android also declares
`usesCleartextTraffic=false`; iOS explicitly disables arbitrary App Transport
Security loads.

Authenticated requests and every body-bearing request use manual/no-redirect
mode on both web fetch and CapacitorHttp. A `3xx` is returned to the caller as a
normal response, so an authorization header, password body, landmark payload, or
GPX document is never replayed automatically to a redirect target.

Capacitor native logging is disabled because bridge debug logs include plugin
arguments. The first-party `PerformanceDiagnostics` plugin does not weaken that
boundary: it accepts only allowlisted sync scope, run ID, phase, duration, and
status values and rejects every malformed or unknown record. It never accepts or
logs reasons, URLs, project data, coordinates, request/response content, or
credentials. Native store failures return stable error codes and never include
tokens, ciphertext, coordinates, or operating-system error details.

## Lifecycle and ownership

`CapacitorCredentialStore` owns the TypeScript/native boundary. The iOS plugin
is registered as an explicit instance by `AppBridgeViewController`; the Android
plugin is registered by `MainActivity`. Instance registration is intentional:
Capacitor 8 ignores `registerPluginType` while its default automatic package
plugin discovery is enabled, but this first-party plugin is compiled directly
into the app target and is not in the generated package plugin list. Native
cryptography and persistence remain behind platform store implementations so
session coordination does not depend on Security or Android Keystore APIs.

`SecureSessionStore` combines that vault with non-secret metadata from
`PreferencesService`. Application bootstrap initializes it before React mounts;
the controller then reads credentials only from its in-memory secure-session
snapshot. Preferences contain `instance`, optional `email`, and
`hasStoredSession`, never a newly written token.

Non-native browser development uses a separate volatile instance of the same
coordinator. Its credential and metadata adapters exist only in memory, so login
remains testable without weakening the native persistence boundary and reload
always returns to an unauthenticated state.

SpeleoDB passwords are never persisted. Bootstrap deletes the obsolete
`speleo_users_db` plaintext record before restoring any session, and the
controller has no local-password parsing or synthetic-token path. Offline use
continues only from a token already restored through the secure-session store.

## Backup and diagnostics boundary

Android disables application backup and cleartext traffic in the manifest. Its
legacy and Android 12+ backup rule files also exclude every root, file,
database, shared-preference, external, and device-protected domain as defense in
depth. Offline project data, map tiles, GPS tracks, pending mutations, and
WebView storage therefore do not enter cloud backup or device transfer.

iOS applies `NSFileProtectionCompleteUntilFirstUserAuthentication` by default,
which keeps background GPS compatible after the first unlock. At every launch,
the app marks Library, Documents, Application Support, and Caches as excluded
from backup; launch fails closed if that policy cannot be applied.

`installDiagnosticRedaction()` wraps every console method before monitoring or
React starts. It bounds diagnostic size and redacts authorization values,
tokens, passwords, cookies, emails, identifiers, project/track names,
coordinates, geometry, headers, request bodies, and payload fields. Sentry drops
HTTP breadcrumbs, request/user/context/extra data, and captures a newly created
sanitized error rather than the original error object. Deep-link URLs are never
logged.

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
- Transport and diagnostic tests prove HTTPS policy, credential-bearing URL
  rejection, redirect suppression, recursive redaction, bounded output, and
  sanitized Sentry events.
- Web and native formatter tests prove performance timing records remain on the
  fixed field/value allowlist while global Capacitor bridge logging stays off.
- Android unit tests exercise the production AES-GCM implementation, randomized
  encryption, authentication-tag failure, missing keys, replacement, clearing,
  and token bounds.
- Signed iOS Keychain tests exercise empty reads, replacement, clearing, byte
  limits, and malformed stored data on a simulator Keychain. Do not disable code
  signing for these tests; an unsigned test host cannot prove Keychain behavior.
- An iOS bridge integration test loads the production `AppBridgeViewController`
  and requires its live bridge to resolve `CredentialStore` to
  `CredentialStorePlugin`. This guards the native registration seam separately
  from Keychain CRUD behavior.
- iOS storage-policy tests exercise backup exclusion on existing, missing, and
  duplicate directories; Android lint validates both backup rule schemas.
- Every native change requires Android unit/release compilation and an iOS
  simulator test/release build in addition to the complete web CI gate.
