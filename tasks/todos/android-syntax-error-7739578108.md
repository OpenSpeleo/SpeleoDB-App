# Android post-login SyntaxError (Sentry 7739578108)

## Plan and verification gates

User authorized unattended reproduction, Android Studio/emulator launch,
test-instance OAuth login, diagnostics changes, and the underlying fix. Do not
print credentials.

- [x] Preserve and reproduce build 160 on the emulator; record Android/WebView
      versions and original parser evidence before changing compatibility
      settings.
- [x] Repair the reporting boundary to retain safe original code locations and
      React component context, while continuing to remove credentials and
      payloads. Gate: production-boundary regression tests, including
      adversarial redaction.
- [x] Prevent the proven unsupported-engine failure before app startup. Gate:
      native startup-routing tests and standalone recovery-page verification.
- [x] Verify real OAuth login and authenticated-screen rendering on Android;
      verify restart and navigation without the error boundary.
- [x] Run lint, typecheck/build, focused tests, full coverage suite, browser
      tests, and applicable Android checks. Document device/OS limitations
      explicitly.
- [x] Update feature/security/build docs and assess customer-facing changelog;
      inspect all native and staged/unstaged diffs before completion.

## Review

Baseline commit: `5b83744` (v1.6.0, Android versionCode 160). The exact local
`index-BiTwPqpP.js` confirms that reported `vs`/`iu` frames originate in error
sanitization/reporting, not the original exception.
`react_component_stack: available` currently retains no actual component stack.

### Root-cause evidence

- Preserved original APK and `index-BiTwPqpP.js` assets under
  `/tmp/speleodb-7739578108/` before building changes.
- Android Studio launched. Android 16 / WebView `134.0.6998.135`: original build
  logs into the configured test instance and renders one map canvas.
- Android 11 / WebView `91.0.4472.114`: the same original build and OAuth login
  trigger `Debugger.scriptFailedToParse` for `TileCacheService-DMhFKo56.js`,
  followed by `SyntaxError: Unexpected token '{'`, `/dashboard`, the
  error-boundary screen, and zero map canvases.
- A temporary emitted-code audit identified 11 class static blocks in the
  TileCacheService chunk and 6 in the MapLibre worker.
- The original Sentry report omits the affected device's engine version, so this
  is a matching reproduced failure, not independently verified device identity.
- Emulator screenshot: `/tmp/speleodb-7739578108/baseline91.png`.
- A diagnostic build lowering syntax exposed a second real WebView 91 failure:
  `TypeError: Object.hasOwn is not a function` in MapLibre paint initialization.
  That temporary build and narrow API shims were discarded after visual checks
  proved the CSS framework is also incompatible (see the decision below).

### Revised implementation decision

Visual verification invalidated partial WebView 91 support: after syntax
lowering and narrow API shims, the React tree mounted but Tailwind's unsupported
CSS left all panels visible and the layout unusable. Those experimental
compatibility and dependency changes were removed. The final fix uses
Capacitor's existing native minimum-engine gate with the actual Tailwind/Vite
Chromium 111 floor, plus a standalone recovery page. It prevents app startup on
unsupported engines and provides update instructions; it does not claim to make
WebView 91 compatible. Diagnostics improvements remain, and the final
verification gates test both unsupported-engine recovery and supported-engine
real login. No user data is cleared or migrated by this check.

### Final verification evidence

- `npm run test.unit -- --run src/controllers/SpeleoDBController.test.ts src/monitoring src/utils/errorDiagnostics.test.ts`:
  244 tests passed.
- `npm run test:ci`: 136 files / 2,274 tests passed; coverage 91.11% statements,
  83.71% branches, 93.17% functions, 93.26% lines. Fixed an existing test setup
  race found by this run: await `waitForOfflineMapsIdle()` before clearing the
  scheduler spy and testing layer opt-in; the action still requires exactly one
  schedule. No production synchronization code changed, retries, or sleeps.
- `npm run lint`, `npm run typecheck`, `npm run build`: passed. All selected
  repository hooks passed after Markdown formatting.
- `npx cap sync android`: succeeded; inspection found no unrelated tracked
  generated Android/iOS changes.
- With Android Studio's bundled JDK, in `android/`:
  `./gradlew :app:assembleDebug :app:assembleRelease :app:testDebugUnitTest :app:lintDebug :app:connectedDebugAndroidTest`:
  passed. All three instrumentation tests passed on each of Android 11/WebView
  91 and Android 16/WebView 134, including the production native startup gate.
- Native API 30 recovery: `/webview-update.html`, visible update instructions,
  zero script elements. Screenshot `/tmp/speleodb-7739578108/recovery91.png`.
- Native API 36.1: real OAuth token login to the configured test instance,
  dashboard imagery, Settings navigation, and force-stop restoration all work;
  no error boundary. Screenshots and structured evidence under
  `/tmp/speleodb-7739578108/final134-*`.
- Full recovery cycle on the **same Android 11 app data**: original build/login
  reproduces the SyntaxError; installing the fix displays recovery; installing
  Google's WebView 134 and matching Trichrome library from the existing SDK
  emulator then reopening restores the saved session and map without logging in
  again or clearing data. `updated-webview-restoration.json` records
  `/dashboard`, one canvas, `restoredSession: true`, and no error boundary.
- Physical affected device and native iOS build/tests are not available evidence
  from this run. The runtime admission change is Android-only; shared
  diagnostics have Chromium/WebKit format tests and browser verification. No
  publication, store upload, version bump, or physical-device claim is made.
- Credentials were loaded in memory from `.env`; no credential was written to
  repository files, screenshots, evidence logs, or command arguments.
- Changelog assessment: customer-facing recovery merits one Fixes entry citing
  the final implementation commit; internal diagnostic/test details are omitted.

- Final `npm run test:browser`: **92 passed** in Chromium and WebKit, including
  packaged recovery-page layout, no external requests, and no app script loads.
- Final Android instrumentation rerun after tightening the page-load snapshot
  assertion: 3 tests on Android 11/WebView 91 and 3 on Android 16/WebView 134,
  all passed. Used `-x :app:buildWebAssetsWithAndroidSentry` against the already
  rebuilt assets so the concurrent browser preview had no asset writer.
- Android unit report: 22 tests across 4 suites, no failures.
- Final debug/release APK builds passed. Both emulators have the final debug APK
  installed; Android Studio remains open. The Android 11 test emulator was
  restored to WebView 91 after proving the update/restoration cycle, so its
  recovery screen remains available for inspection.
- `npm run quality:inventory`: passed. Added the existing `CHANGELOG.md` to the
  documentation classification; it was the only unclassified baseline file.
- `git diff --check`: passed; no dependency/lockfile or unrelated generated
  native changes remain. Evidence files were checked for `.env` credential
  values: zero matches.
- Test setup repair commit: `dd038b6`. Final implementation: `7db65fd`.
  `CHANGELOG.md` Unreleased cites that implementation; the follow-up commit is
  named `[Changelog Update]`. All task-owned changes are committed locally.

### Firewall-disabled revalidation

User requested emulator restart and complete revalidation after disabling the
host firewall. Preserve the supported and unsupported WebView comparison.

- [x] Restart both Android emulators and verify their engine versions.
- [x] Rerun lint, types, build, full coverage, browser, and Android checks.
- [x] Verify authenticated test-instance network access, login, map/navigation,
      and session restoration on the supported engine.
- [x] Verify the older engine still displays the update recovery screen.
- [x] Record results and any remaining limitations without publishing changes.

#### Revalidation results (September 18, 2026)

- Restarted Android 11/WebView 91 and Android 16/WebView 134; Android Studio
  remains open. Android 16 stalled during the initial reboot, requiring a cold
  start. The first Gradle run returned success despite executing zero tests on
  that unavailable device. Checked the XML report and reran its three device
  tests only after boot completion; all passed. A transient emulator System UI
  not-responding dialog was dismissed, and subsequent app interaction worked.
- `npm run lint`, `npm run typecheck`, `npm run quality:inventory`, and
  `npm run build`: passed. `npm run test:ci`: 136 files / 2,274 tests passed,
  statements 91.11%, branches 83.71%, functions 93.17%, lines 93.26%.
- `npm run test:browser`: all 92 Chromium/WebKit tests passed, retries disabled.
  All asset-writing builds finished before browser verification.
- With Android Studio's JDK,
  `./gradlew :app:assembleDebug :app:assembleRelease :app:testDebugUnitTest :app:lintDebug :app:connectedDebugAndroidTest`
  completed. Explicitly reran `:app:testDebugUnitTest --rerun` (22 passed), and
  used `ANDROID_SERIAL` with
  `:app:connectedDebugAndroidTest -x :app:buildWebAssetsWithAndroidSentry` to
  verify each booted emulator: three passed on each, six total, no failures or
  skipped tests.
- Real OAuth login and manual Settings resync succeeded. Native HTTP monitoring
  recorded only paths/status/counts/timing, never headers or payload contents:
  all 17 requests returned HTTP 200. The test account has zero projects, tracks,
  landmarks, stations, leads, and cylinder installations; the collection list
  contains one item. Empty project lists reflect server data, not blocked
  access.
- Visually verified satellite imagery, recovery instructions, and Settings.
  Projects, Geometries, Landmarks, GPS, Settings, and Map navigation worked.
  Force-stop/reopen restored `/dashboard`, the session, and a map canvas without
  an error boundary.
- Reinstalled the original build on WebView 91 with the firewall disabled:
  `TileCacheService-DMhFKo56.js` again failed to parse with
  `SyntaxError: Unexpected token '{'`; the dashboard showed its error boundary
  and no map canvas. Installing the fix on the same data showed the script-free
  recovery page. Updating the engine to WebView 134 restored the existing
  session and map without logging in again. Restored WebView 91 afterward to
  keep the compatibility recovery example available.
- Evidence: `/tmp/speleodb-7739578108/firewall-*` logs, JSON, and screenshots.
  This follow-up changes verification documentation only; no product changes,
  changelog entry, publication, or release were needed. The production fix
  remains `7db65fd`. Live tests are limited by the empty test dataset; populated
  data behavior has automated coverage. Physical-device and native iOS testing
  remain outside the available evidence.
- Repository hooks and `git diff --check` passed. Scanned the 17 new text
  evidence files against the configured credentials: zero matches.
