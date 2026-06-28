# Restore iOS authentication through secure storage

## Problem

Successful server authentication cannot establish an iOS session because the
first-party `CredentialStore` Capacitor plugin is absent from the runtime
bridge. `AppBridgeViewController` currently calls `registerPluginType`, but
Capacitor 8.4.0 makes that API a no-op while automatic package plugin discovery
is enabled (the default). The JavaScript credential adapter therefore rejects
its first native call, and session coordination correctly fails closed.

The Xcode console messages in the report do not identify this failure: they are
unrelated WebKit, keyboard-extension, and RunningBoard diagnostics. The app
also deliberately disables Capacitor bridge logging to avoid leaking plugin
arguments.

## Plan

- [x] Register the first-party iOS credential plugin through the bridge's
      explicit instance-registration path, which remains active alongside
      automatic package plugin discovery.
- [x] Add an iOS regression test at the loaded bridge seam that proves the
      production `AppBridgeViewController` exposes `CredentialStore`.
- [x] Update authentication/security documentation with the registration
      ownership, failure mode, verification seam, and performance impact.
- [ ] Run focused iOS bridge and Keychain tests.
- [ ] Run repository lint, type checking, full tests with coverage, production
      web build, and iOS Debug/Release simulator compilation.
- [ ] Inspect all diffs, record exact results and limitations below, and only
      then mark proven items complete.

## Verification gates

1. The real `AppBridgeViewController` loads a bridge for which
   `plugin(withName: "CredentialStore")` is a `CredentialStorePlugin`.
2. Existing Keychain CRUD and fail-closed tests remain green.
3. Web quality gates remain green because the TypeScript/native contract is
   unchanged.
4. Debug and Release iOS simulator builds compile the same controller and
   plugin sources used on device.
5. Physical-device login is called out separately because simulator tests and
   compilation cannot prove the user's device/network interaction.

## Review

Pending implementation and verification.
