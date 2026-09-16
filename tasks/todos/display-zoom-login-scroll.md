# Display Zoom and reachable login actions

## Intent and plan

The user reported a zoomed login page with Sign In clipped below the screen and
no way to scroll, and identified Display Zoom / Display size as the setting. OS
display scaling changes the logical viewport; the app cannot promise an
identical physical size across both platforms. Preserve responsive sizing and
make overflowing content reachable instead of applying inverse screen
transforms.

- [x] Inspect global scaling, Ionic layout, native configuration, and route
      scroll ownership. Ionic fixes and clips body; Login has no independent
      scroll owner.
- [x] Check in with the user before implementation: explain the OS boundary and
      the concrete missing scroll container.
- [x] Reproduce the clipped login in a real layout engine before the fix.
- [x] Give login a viewport-bounded scroll container with safe-area padding and
      overflow-safe centering. Audit other routes for the same missing
      ownership.
- [x] Add regression evidence at the rendering seam for short/narrow viewports,
      larger content, both login methods, and a reachable/clickable submit
      button.
- [x] Document the app-wide display-scaling boundary and login scroll ownership.
- [x] Run focused tests, lint, typecheck/build, full coverage, and applicable
      native checks; record runtime limitations explicitly.
- [ ] Release gate: record physical iOS/Android Display Zoom, keyboard, and
      touch-scroll results using the matrix in `docs/display-scaling.md`.

## Verification gates

- Reproduction must fail before the fix and pass after with production markup
  and production CSS, not mocked element dimensions or a duplicate layout.
- Login's bottom actions must be reachable at reduced portrait/landscape heights
  and enlarged font sizes; top content must remain reachable too.
- Existing authenticated pages retain their own Ionic/explicit scroll owners;
  the map retains its intentional gesture surface.
- Physical iOS/Android Display Zoom, keyboard, and touch-scroll verification is
  required for release; browser viewport tests are not OS-setting evidence.

## Review

Baseline: `b261206`. No commits created; changes remain in the working tree.

### Implementation and evidence

- Production changes are limited to Login's scroll ownership and safe-area
  padding. Other main routes already have Ionic or explicit scroll owners; their
  source audit is recorded in `docs/display-scaling.md`. No native source or
  generated native configuration changed.
- Added pinned development-only `@playwright/test@1.62.1` because jsdom has no
  layout engine. Lockfile review shows only Playwright, its runner/core, and
  optional macOS `fsevents`; no existing dependency upgrades or replacements.
  Node >=20 is compatible with CI's Node 22. Local commands used Node 26.5.0.
- Before the production fix, `npm run build` followed by
  `npm run test:browser -- --project=webkit --grep 'password login remains reachable: small portrait'`
  failed: the real submit button had no user-scrollable ancestor.
  `/tmp/speleodb-display-red.log` records the failure.
- After the fix, `npm run build && npm run test:browser` passed all 20 cases in
  WebKit/Chromium, with zero retries and no unexpected browser console output.
  Chromium also exercises wheel-driven scrolling; Playwright does not support
  wheel input in mobile WebKit, whose tests exercise actual scroll geometry and
  pointer taps. Both engines prove native form validation is reached by tapping
  Sign In. No authentication requests are made.
- Visually inspected the normal portrait Chromium, landscape Chromium, and
  enlarged-text WebKit screenshots under `test-results/`. Sign In, Sign up, and
  the bottom note remain visible after scrolling, with safe-area clearance.
- `npm run lint`, `npm run typecheck`, and `npm run build`: passed, including
  type checking the new browser configuration/tests.
- `npm run test:ci`: 118 files / 1,939 tests passed. Coverage: statements
  90.53%, branches 82.19%, functions 93.27%, lines 92.67%.
- `npm run quality:inventory`: passed for all 614 tracked files. New browser
  files have explicit quality classification patterns.
- `npm ci --dry-run --no-audit --no-fund --ignore-scripts --workspaces=false`:
  passed. Manifest and lockfile are synchronized.
- Android:
  `cd android && ./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug`
  passed. `adb devices` listed no connected devices, so instrumentation and
  physical-device touch/display tests were unavailable.
- iOS:
  `xcodebuild -quiet -project ios/App/App.xcodeproj -scheme SpeleoDB -destination 'platform=iOS Simulator,id=97651005-09C1-438C-B515-154D1B32FCD8' build`
  exited 0 and produced `SpeleoDB.app`. The log contains third-party plugin
  compiler warnings and Xcode diagnostics saying a command failed with exit code
  0; the build command itself succeeded.
- iOS native tests could not run: the documented `App` scheme no longer exists;
  `xcodebuild -list` identifies `SpeleoDB`, but
  `xcodebuild ... -scheme SpeleoDB ... test` reports that it is not configured
  for the test action. Scheme repair is outside this CSS/layout change.
- A separate optional `tsc --project tsconfig.node.json --noEmit` exposed an
  existing implicit-any diagnostic in `vite.config.ts`'s `onConsoleLog`
  callback. The normal app typecheck/build pass. Browser tests are included in
  the normal app typecheck; no unrelated tooling changes were made.

### Limits

No claim of fixed physical sizing or OS-level Display Zoom emulation is made.
The original user's device setting, native keyboard resize behavior, and touch
scrolling still need physical-device evidence. Network/storage/concurrency
contracts are unchanged and remain covered by the existing suite. Browser tests
are now a blocking step in the production web-build CI job.

### Follow-up: remove login helper notes

The user requested removal of the offline-access, native password-autofill, and
token-connection notes. All three are removed from Login. Component tests assert
their absence in both login methods while retaining the real autofill attribute
assertions. Authentication behavior is unchanged.

The shorter form can fit without overflow on a normal portrait screen, so the
browser suite now asserts a scroll owner on every size and actual overflow on
the reduced-height/enlarged-text cases. Wheel assertions verify the available
scroll distance, including zero when content fits. The earlier screenshot record
above predates the requested note removal.

Verification: 25 focused Login tests, 20 browser cases, lint/build, and all
1,939 covered tests passed after removing all three notes. The browser test
verifies scroll-to-top before triggering invalid-input validation, because
WebKit can asynchronously scroll the focused invalid field into view; no sleeps
or relaxed visibility assertions were added. Native checks are not repeated for
copy-only removal; native behavior and configuration are unchanged.

### Follow-up: Get OAuth Token

- [x] Add an OAuth-tab-only secondary button link beneath the shared instance
      input, targeting the normalized current instance plus
      `/private/auth-token/`. Reuse `INSTANCE_PATHS` and `openExternalUrl` /
      Capacitor Browser.
- [x] Verify default and edited instance URLs, native-browser delegation, no
      accidental form submission, and visibility only in the token tab.
- [x] Update authentication/external-link docs and run component, browser,
      lint/build, and covered regression checks.

The new component regression failed before implementation because the link was
absent. After implementation,
`npm run test.unit -- --run src/pages/Login.test.tsx src/utils/url.test.ts`
passed all 30 tests, and `npm run lint`, `npm run build`, and
`npm run test:browser` passed (20 browser cases). The token layout checks also
assert the new button remains in the viewport after scrolling. Visually checked
the small-portrait WebKit token page with both actions visible.

Native browser behavior reuses the established Capacitor Browser helper; no
plugin, native configuration, or dependency change was needed for this action.
The component test verifies the actual `Browser.open` boundary with default and
live-edited instance URLs and confirms no login submission. A physical browser
presentation check remains part of device verification.

Final `npm run test:ci`: 118 files / 1,940 tests passed. Coverage: statements
90.53%, branches 82.18%, functions 93.28%, lines 92.67%. Markdown formatting and
`git diff --check` passed. No commits were created.

### Final adversarial review and commit

The user invoked `review-agent` for the complete working tree and requested
tests, then `prek run -a`, then a commit. The review agent owns application and
browser-test corrections; the primary agent owns dependency/CI review,
integration verification, staging, and the final commit.

- [x] Review staged and unstaged changes, including dependency changes beyond
      the original Playwright addition. The user confirmed these are intentional
      and must be included and verified.
- [x] Complete adversarial review, review the corrective plan, and fix
      actionable findings with focused evidence.
- [x] Run the full covered suite, production build/browser suite, and applicable
      native validation on the final changes.
- [x] Run `prek run -a`, inspect and resolve hook changes, and verify the final
      staged/unstaged diff.
- [x] Stage all reviewed changes for the authorized commit. The final response
      records the resulting commit reference after commit success.

The adversarial reviewer found one actionable P2: account-link click handlers
discarded rejected native-browser promises, resulting in an unhandled rejection
and no user feedback. The reviewed corrective plan introduced a shared,
mounted-safe Login handler, fixed generic alert text, and tests for all three
links failing/retrying plus rejection after unmount. Before the correction,
three tests and three unhandled-rejection checks failed; afterward all 34
focused tests passed. No other actionable application/layout findings remained.
The reusable rule was added to `tasks/lessons/native-ui-trigger-evidence.md`.

The user confirmed the additional dependency changes: 83 existing npm package
entries changed version, including Capacitor CLI 8.4.3, Share 8.0.2, MapLibre
6.10.0/react-map-gl 8.1.3, and Vite 8.3.0. The iOS lockfile also selects
Filesystem 1.1.4 and Sentry 9.28.0. These supersede the earlier review's
Playwright-only dependency scope. `npm ls --depth=0`, the npm clean-install dry
run, and `npm audit --json` passed (zero reported vulnerabilities).

Primary-source review included
[MapLibre 6.10.0](https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.10.0),
[Filesystem 1.1.4](https://github.com/ionic-team/ion-ios-filesystem/releases/tag/1.1.4),
and
[Sentry 9.28.0](https://github.com/getsentry/sentry-cocoa/releases/tag/9.28.0).
Filesystem's directory-containment fix is compatible with the app's generated
cache-relative GPX filename; Sentry's new hint APIs require no app API
migration. The updated versions satisfy the installed package manifests. Map
rendering and native UI behavior still require the physical-device release
matrix.

Final web verification used official Node 22.23.2, matching CI's Node major:
`npm run lint`, `npm run typecheck`, `npm run build`, and `npm run test:browser`
passed; browser results are 20/20 with zero retries. `npm run test:ci` passed
1,944 tests across 118 files, with statements 90.54%, branches 82.19%, functions
93.28%, and lines 92.68% coverage. Capacitor doctor accepted both platforms, and
`cap sync` produced no additional tracked native diff beyond the explicitly
approved iOS package-lock changes.

Native verification on the refreshed dependencies passed:

- `cd android && ./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest`
  completed successfully. Instrumentation tests compiled; no Android device was
  connected to execute them.
- `xcodebuild -project ios/App/App.xcodeproj -scheme SpeleoDB -destination 'platform=iOS Simulator,id=97651005-09C1-438C-B515-154D1B32FCD8' -disableAutomaticPackageResolution -onlyUsePackageVersionsFromResolvedFile build`
  reported `BUILD SUCCEEDED`, preserving the approved Filesystem/Sentry pins.
  The existing missing iOS scheme test action and stale App test-host path
  remain native-test limitations; no new native test success is claimed.

The CI documentation now accurately identifies the already-disabled iOS smoke
job as disabled; the workflow's enabled jobs and action version tags are
preserved.

Final `prek run -a` passed after its first run formatted three Markdown files.
No application changes were made by hooks. The staged diff passed whitespace
checks and there were no unstaged changes before commit preparation completed.
All requested changes, including the confirmed dependency updates, are included.
