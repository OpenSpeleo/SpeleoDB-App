# Keep Screen Awake While Foregrounded

## Goal

Keep the display awake on every SpeleoDB screen while the native Android or iOS
app is foreground-active, without adding a plugin, permission, background
service, JavaScript state, or user setting.

## Implementation gates

- [x] Apply Android's activity-scoped keep-screen-on window flag.
- [x] Disable the iOS idle timer only while the app scene is active.
- [x] Add Android and iOS native tests at the lifecycle seams.
- [x] Document intent, ownership, alternatives, limitations, power impact, and
      verification; add the document to the docs index.

## Verification gates

- [x] Run lint, type checking/build, and the complete Vitest suite with
      coverage.
- [x] Sync both Capacitor platforms and inspect every tracked generated diff.
- [x] Run Android unit tests, debug assembly, and connected instrumentation
      tests.
- [x] Run the iOS App tests on a simulator and compile for a generic iOS device.
- [ ] Record physical Android and iOS timeout/background/return/manual-lock
      evidence, or leave this gate open and identify it as a release limitation.
- [x] Run final diff and repository-hygiene checks.

## Locked decisions

- The behavior is always enabled on every native app screen while foregrounded.
- Android uses `FLAG_KEEP_SCREEN_ON`; iOS uses `isIdleTimerDisabled` from the
  UIScene active/resign callbacks.
- Browser/PWA behavior is unchanged.
- Automatic idle dimming and auto-lock are prevented. User-initiated locks and
  mandatory OS safety behavior remain authoritative.

## Review

### Result

- Android's production `MainActivity` adds `FLAG_KEEP_SCREEN_ON` after Capacitor
  activity creation. The flag is window-scoped and requires no permission.
- iOS's production `SceneDelegate` disables the application idle timer only
  between the scene active and resign-active callbacks.
- The behavior is native and global; no JavaScript, route, authentication, GPS,
  plugin, persistence, manifest, or public API changes were introduced.
- `docs/screen-awake.md` records the architecture, alternatives, power impact,
  operating-system boundaries, and release verification matrix.

### Automated verification

- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm run build` — passed; the production Vite bundle completed successfully.
- `npm run test:ci` — passed with network access: 106 files and 1,820 tests;
  coverage was 90.01% statements, 82.05% branches, 92.83% functions, and 92.00%
  lines. The first sandboxed attempt could not resolve `stage.speleodb.org`; the
  unchanged suite passed after the configured live integration tests received
  network access.
- `npx cap sync android` and `npx cap sync ios` — passed with 13 Android and 12
  iOS plugins. Inspection found no unexpected tracked generated changes.
- `cd android && ./gradlew testDebugUnitTest assembleDebug assembleDebugAndroidTest`
  — passed: 926 actionable tasks. This compiled the production activity and the
  instrumentation test APK.
- `cd android && ./gradlew :app:connectedDebugAndroidTest` — passed the one app
  instrumentation test on `Medium_Phone_API_36.1` (API 36.1). The test launches
  the real `MainActivity` and asserts its real window flags.
- `xcodebuild -project App.xcodeproj -scheme App -destination 'platform=iOS Simulator,id=1CF6D30D-531B-4951-8DE7-43AC10CDA7A8' test`
  — passed all 10 App tests on iPhone 17 Pro / iOS 26.5, including the
  production `SceneDelegate` idle-timer transition test.
- `xcodebuild -project App.xcodeproj -scheme App -configuration Debug -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_ENTITLEMENTS='' build`
  — passed the unsigned arm64 generic-device compile.
- `git diff --check` — passed. Final status/diff inspection found only files
  owned by this task.

### Physical-device limitation

The physical-device gate remains open. ADB reported no attached Android device,
and Xcode listed the configured iOS device `Pandalicious` as offline. The
Android emulator proves the production window flag is present, but its boot
configuration disables normal screen timeout and therefore cannot prove real
display dimming or locking. Before release, a physical Android device and
physical iOS device must still exercise the foreground timeout, background
timeout restoration, foreground re-entry, and hardware-lock cases listed in
`docs/screen-awake.md`.

Commit references: none; no commit was requested.
