# Require iOS 16.4 or later

## Plan

User explicitly requested dropping iOS 15 and supporting iOS 16.4 onward. The
install requirement must match the existing web bundle's engine floor.

- [x] Set project, app, and native test deployment targets to iOS 16.4.
- [x] Regenerate Capacitor's Swift package and inspect all generated changes.
- [x] Extend the real configuration contract test and document the OS floor.
- [x] Pass lint, types/build, focused tests, full coverage, and inventory.
- [x] Build the iOS app, inspect its packaged minimum OS, and run signed native
      simulator tests; record simulator/version limitations.
- [ ] Commit the implementation and customer-facing changelog separately.

## Verification scope

The Xcode deployment target owns installation admission. Validate all Debug and
Release configurations and the built app's MinimumOSVersion, alongside the Vite
Safari/iOS targets. Capacitor generates only a major-version floor for its
internal Swift dependency package; this must not lower the app install floor. No
Android production behavior or web UI changes are intended. Existing Android and
browser verification remains applicable; native iOS verification is required.

## Review

- All six Xcode deployment declarations now require 16.4. `npx cap sync ios`
  regenerated only the expected package major floor, from `.v15` to `.v16`; no
  unrelated native changes or dependency upgrades. Vite already targets 16.4.
- README and CI documentation state the minimum version and distinguish the
  generated dependency package from the app's install requirement.
- `npm run test.unit -- --run src/monitoring/webviewCompatibility.test.ts`:
  three passed. `npm run lint`, `npm run typecheck`, and
  `npm run quality:inventory` passed. `npm run test:ci`: 136 files / 2,275 tests
  passed; statement coverage 91.11%, branch coverage 83.71%, function coverage
  93.17%, line coverage 93.26%.
- Debug simulator and unsigned Release device builds succeeded. Both packaged
  `Info.plist` files have `MinimumOSVersion = 16.4`; `xcrun vtool -show-build`
  also reports `minos 16.4` for both executables.
- Native tests use normal simulator signing. Initial 27 tests passed; Xcode's
  subsequent `simctl diagnose` collector stalled. Stopped only that collector,
  preserving logs; Xcode then exited zero with `TEST SUCCEEDED`. Final run adds
  the packaged-minimum assertion and disables verbose diagnostic collection with
  `-collect-test-diagnostics never`; assertions and retries are unchanged.
- Simulator: iPhone 18 Pro, iOS 27.0, Xcode 27.0. No iOS 16.4 runtime or
  physical device was available; this proves the install metadata and
  current-runtime native behavior, not an oldest-supported-device runtime claim.
- Android and browser rendering suites are not rerun for this native deployment
  metadata change; neither production Android nor web rendering code changed,
  and both passed in the preceding firewall-disabled verification.
- Logs:
  `/tmp/speleodb-ios16-{sync,focused,coverage,native-tests,native-final,release}.log`.
  Native build commands:

  ```sh
  xcodebuild -project ios/App/App.xcodeproj -scheme SpeleoDB \
    -configuration Debug \
    -destination 'platform=iOS Simulator,id=BA0876D4-75BB-478F-8A7B-418E080EC33E' \
    -derivedDataPath /tmp/speleodb-ios16-verification \
    -collect-test-diagnostics never test
  xcodebuild -project ios/App/App.xcodeproj -scheme SpeleoDB \
    -configuration Release -destination 'generic/platform=iOS' \
    -derivedDataPath /tmp/speleodb-ios16-release CODE_SIGNING_ALLOWED=NO build
  ```

- Final signed simulator run: 28 tests passed, zero failures, `TEST SUCCEEDED`.
