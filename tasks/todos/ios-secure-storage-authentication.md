# Restore iOS authentication through secure storage

## Problem

Successful server authentication cannot establish an iOS session because the
first-party `CredentialStore` Capacitor plugin is absent from the runtime
bridge. `AppBridgeViewController` currently calls `registerPluginType`, but
Capacitor 8.4.0 makes that API a no-op while automatic package plugin discovery
is enabled (the default). The JavaScript credential adapter therefore rejects
its first native call, and session coordination correctly fails closed.

The Xcode console messages in the report do not identify this failure: they are
unrelated WebKit, keyboard-extension, and RunningBoard diagnostics. The app also
deliberately disables Capacitor bridge logging to avoid leaking plugin
arguments.

## Plan

- [x] Register the first-party iOS credential plugin through the bridge's
      explicit instance-registration path, which remains active alongside
      automatic package plugin discovery.
- [x] Add an iOS regression test at the loaded bridge seam that proves the
      production `AppBridgeViewController` exposes `CredentialStore`.
- [x] Update authentication/security documentation with the registration
      ownership, failure mode, verification seam, and performance impact.
- [x] Run focused iOS bridge and Keychain tests.
- [x] Run repository lint, type checking, full tests with coverage, production
      web build, and iOS Debug/Release simulator compilation.
- [x] Inspect all diffs, record exact results and limitations below, and only
      then mark proven items complete.

## Verification gates

1. The real `AppBridgeViewController` loads a bridge for which
   `plugin(withName: "CredentialStore")` is a `CredentialStorePlugin`.
2. Existing Keychain CRUD and fail-closed tests remain green.
3. Web quality gates remain green because the TypeScript/native contract is
   unchanged.
4. Debug and Release iOS simulator builds compile the same controller and plugin
   sources used on device.
5. Physical-device login is called out separately because simulator tests and
   compilation cannot prove the user's device/network interaction.

## Review

### Result

- Replaced the ineffective iOS `registerPluginType` call with explicit
  `CredentialStorePlugin` instance registration. Automatic discovery remains
  enabled for package plugins.
- Added an XCTest that loads the production bridge controller and resolves the
  registered plugin by its JavaScript name.
- Updated authentication and secure-storage documentation with the ownership,
  fail-closed behavior, regression seam, and negligible one-instance startup
  cost.
- Commit containing the implementation: `e0551b8`
  (`[Fix] Credentials Secure Storage Interacting with Capacitor 8`).

### Verification

- `npm run quality:inventory`: passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run test:ci`: 94 files and 1,610 tests passed with coverage after
  allowing the live integration tests to reach `stage.speleodb.org`.
- `npm run build`: passed with Vite 8.0.16 (588 modules transformed).
- Focused signed iOS bridge test on iPhone 17 Pro / iOS 26.5: 1/1 passed.
- Complete signed iOS XCTest target on iPhone 17 Pro / iOS 26.5: 8/8 passed,
  including five Keychain, two storage-policy, and one bridge test.
- Debug and Release generic iOS Simulator builds: passed.
- `plutil -lint ios/App/App.xcodeproj/project.pbxproj`: passed.
- `git diff --check` and the solid-button invariant search: passed.

The initial sandboxed web run could not resolve `stage.speleodb.org`; the same
suite passed unchanged with network access. An initial unsigned iOS test run
also demonstrated that Keychain tests require a signed test host; the signed run
passed and the reusable rule is captured in
`tasks/lessons/ios-keychain-tests-require-signing.md`.

### Limitations

- No physical-device login was performed from this environment. Compilation,
  live-bridge registration, and real simulator Keychain behavior are proven;
  final device/network interaction remains a device smoke test.
- Android verification is inapplicable because no Android source, configuration,
  dependency, or generated file changed.

### Follow-up audit

The commit also acquired unrelated `fetch` and `processing` iOS background modes
while Xcode rewrote project metadata. SpeleoDB schedules neither mode; the
mobile hardening ledger tracks their removal and a compiled-configuration
regression test as a separate objective.
