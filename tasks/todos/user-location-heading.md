# Live User Location Toggle and Heading Cone

## Goal

Replace the one-shot My Location action with a foreground live-location toggle
and render one reusable Google-style blue direction cone for either that live
mode or an actively recording GPS track.

## Implementation gates

- [x] Add the pinned Capacitor compass dependency and inspect every generated
      Android/iOS synchronization change.
- [x] Add a race-safe foreground live-location coordinator with explicit
      activation, deactivation, route suspension, and app-lifecycle suspension.
- [x] Add a reference-counted native heading service with bounded updates,
      normalization, wrap-safe animation, and dot-only fallback.
- [x] Add the reusable MapLibre user-location indicator while preserving the
      direct Source-to-Layer and long-press hit-testing contracts.
- [x] Centralize manual/recording position selection and paused/idle heading
      policy without changing persisted track data or sampling cadence.
- [x] Update feature, map architecture, GPS, privacy, and index documentation.

## Verification gates

- [x] Focused live-location, heading, indicator, selection, Dashboard, and
      authenticated-shell tests pass.
- [x] Lint, type checking, production build, complete coverage suite, Prek
      hooks, hard-rule scans, and diff checks pass.
- [x] Capacitor Android/iOS synchronization succeeds and every tracked native
      diff is owned by this task.
- [x] Android unit/debug/androidTest compilation and iOS simulator/generic
      device compilation pass.
- [ ] Physical Android and iOS cardinal, wraparound, portrait/landscape, toggle,
      recording pause/resume, lifecycle, and unavailable-compass evidence is
      recorded, or the gate remains open as a release limitation.

## Locked decisions

- My Location is a true toggle. Explicit deactivation clears its coordinate and
  releases its foreground location watch.
- A paused recording retains its last valid dot but does not own a live cone.
- Independently enabled My Location remains live while recording is paused.
- Manual live location takes visual priority over a recording point because it
  updates more frequently.
- Route/app suspension stops native listeners without changing the user's live
  location toggle state; returning resumes without automatic camera movement.
- Phone compass heading is never substituted with GPS course or bearing.
- Heading is ephemeral and is never persisted, logged, or transmitted.
- Web and unavailable-sensor behavior is dot-only.

## Review

### Result

- My Location is now a cancellable foreground toggle with first-fix loading,
  one-time centering/haptics, continuous marker updates, and route/app
  suspension that retains the user's selected mode.
- A shared `UserLocationIndicator` owns the blue dot and fixed-size heading
  cone. Manual live location takes priority over accepted recording points;
  recording pause retains only the dot, and disabling all live reasons removes
  both dot and cone.
- Follow-up visual calibration changed the cone to a substantially darker,
  less-transparent blue gradient while preserving its geometry and shared
  rendering path.
- Follow-up native diagnostics moved all compass UIKit orientation reads and
  sensor start/stop work off Capacitor's bridge queue and onto the main queue,
  made the lifecycle idempotent, and declared all four supported interface
  orientations.
- One reference-counted heading service owns the native compass and degrades
  silently to dot-only rendering when the sensor is unavailable.
- `@capgo/capacitor-compass` is pinned at `8.1.17`. A fail-fast postinstall
  patch corrects the upstream iOS listener lifetime and display-orientation
  handling so native location/heading sensors run only while JavaScript has an
  active listener.

### Automated verification

- `npx vitest run src/hooks/useLiveUserLocation.test.ts src/services/DeviceHeadingService.test.ts src/components/map/UserLocationIndicator.test.tsx src/utils/userLocation.test.ts src/hooks/useAppForeground.test.ts src/pages/Dashboard.test.tsx src/pages/dashboard/DashboardMapLayers.test.tsx src/pages/dashboard/useDashboardGpsRecordingActions.test.ts src/pages/dashboard/useDashboardMapShell.test.ts src/AuthenticatedAppShell.test.tsx`
  — 10 files and 161 tests passed.
- `make ci` — lint, type checking, the production build, and the complete
  covered suite passed: 111 files and 1,843 tests; 90.17% statements, 82.30%
  branches, 92.63% functions, and 92.13% lines.
- `make pre-commit` — trailing whitespace, EOF, structured-file, secret,
  Markdown formatting, ESLint, lockfile consistency, TypeScript, and production
  build hooks passed. The formatter hooks required a second stable-index pass
  after applying their deterministic edits.
- `rg -n 'app-btn[^\"]*bg-' src -g '*.tsx'` returned no forbidden button fills.
  The production-like indicator test proves `user-location-dot` remains a direct
  child of `user-location-source`. `git diff --check` passed.
- The first sandboxed `make ci` attempt could not resolve live integration-test
  hosts; rerunning with normal network access produced the passing result above.

### Native verification and generated-diff inspection

- `node scripts/patch-capgo-compass-package.mjs` passed twice, proving the patch
  is both applied and idempotent.
- `plutil -lint ios/App/App/Info.plist` passed after declaring all four
  interface orientations.
  `xcodebuild -quiet -project App.xcodeproj -scheme App -configuration Debug -destination 'platform=iOS,id=00008130-001170941E98001C' build`
  passed without the prior incomplete-orientation warning after the main-thread
  compass correction.
- Physical Main Thread Checker logs had shown `UIApplication.connectedScenes`,
  `UIScene.activationState`, and `UIWindowScene.interfaceOrientation` being read
  from Capacitor's bridge queue. The reusable prevention rule is recorded in
  `tasks/lessons/capacitor-plugin-main-thread-ui.md`; a final on-device cone
  activation is still required to prove the runtime warning is gone.
- `npx cap sync android` and `npx cap sync ios` passed with the compass included
  among 14 Android and 13 iOS plugins.
- After Xcode reported a stale `Missing package product 'CapApp-SPM'` issue,
  `xcodebuild -resolvePackageDependencies -project App.xcodeproj -scheme App`
  resolved both the local `CapApp-SPM` and `CapgoCapacitorCompass` packages
  successfully without adding tracked output.
- Capacitor synchronization changed only the task-owned dependency wiring:
  `android/app/capacitor.build.gradle`, `android/capacitor.settings.gradle`, and
  `ios/App/CapApp-SPM/Package.swift`. Pre-existing screen-awake native and
  documentation work was preserved.
- `./gradlew testDebugUnitTest assembleDebug assembleDebugAndroidTest` — passed
  with 983 actionable tasks (55 executed, 928 up to date).
- `xcodebuild -project App.xcodeproj -scheme App -destination 'platform=iOS Simulator,id=1CF6D30D-531B-4951-8DE7-43AC10CDA7A8' -derivedDataPath /tmp/speleodb-heading-ios-signed test`
  — all 10 App tests passed on an iPhone 17 Pro simulator running iOS 26.5.
- `xcodebuild -project App.xcodeproj -scheme App -configuration Debug -destination 'generic/platform=iOS' -derivedDataPath /tmp/speleodb-heading-ios-device CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_ENTITLEMENTS='' build`
  — generic iOS device compilation passed.
- `xcodebuild -project App.xcodeproj -scheme App -configuration Debug -destination 'platform=iOS,id=00008130-001170941E98001C' -derivedDataPath /tmp/speleodb-heading-physical build`
  — the signed build for `Pandalicious` passed, including package resolution,
  the web-assets shell phase, compass compilation, and code signing.
- After Xcode reported that `SentrySerializable.h` had changed since its cached
  `.pcm` was built, only the named `App-bumamyuymhnispcgrfuisbrdosls`
  DerivedData directory was removed. Package resolution repopulated the
  Capacitor/Sentry XCFrameworks, and the same signed device build using Xcode's
  normal DerivedData location passed. The reusable recovery rule is recorded in
  `tasks/lessons/ios-derived-data-package-modules.md`.
- An earlier unsigned simulator-test attempt compiled the app and compass but
  could not run Keychain tests because those tests require signing; the signed
  simulator command above is the authoritative passing result.

### Open physical-device gate

- `adb devices -l` reported no attached Android device.
- `xcrun devicectl list devices` reported a connected iPhone 15 Pro Max named
  `Pandalicious`, but no operator was available to rotate and visually inspect
  the app. Physical Android and iOS evidence therefore remains open for
  stationary cardinal rotation, 359°/0° wraparound, portrait/landscape
  alignment, toggle behavior, recording pause/resume, route/background
  suspension, and unavailable-compass fallback. Simulator/native compilation
  does not close this release gate.

### Commit references

- None. No commit was requested or created.
