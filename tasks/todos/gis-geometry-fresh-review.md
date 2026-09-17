# Fresh adversarial GIS Geometry review

## Objective and plan

Independently review the entire feature from `65d4b55` through `c20cb42`,
including prior corrective work. Earlier test success is context, not proof of
unexamined failure modes. User explicitly requested another review and
authorized corrective work, full tests, `prek run -a`, and a commit.

- [x] Fresh authority reviewer: cache, revision/access ordering, interrupted
      persistence, account lifecycle and revocation/regrant.
- [x] Fresh tile reviewer: ready-source publication, shared area ownership,
      cancellation, layer changes and actual downloads.
- [x] Fresh transport/UI reviewer: native and web status handling, security,
      parsing, visibility, camera intent and bounds.
- [x] Primary: integration call paths, review evidence quality, reproduce and
      resolve confirmed findings with production-seam tests.
- [x] Independently review corrections and run full coverage, lint, TypeScript,
      production build, browser tests and applicable native checks.
- [x] Run `prek run -a`, inspect staged/unstaged changes, commit review-owned
      changes and report exact results and remaining limits.

## Ownership and verification environment

Reviewers have non-overlapping file ownership; primary owns integration,
repository-wide checks, documentation and commit. Do not change unrelated
`package.json` / `package-lock.json` Sentry updates. The existing isolated
verification checkout will use committed dependencies; results will explicitly
identify this distinction. Physical-device evidence cannot be inferred from
compilation or simulator/browser tests.

## Review findings and evidence

The independently reviewed corrective plans were reproduced and implemented:

1. Repeated collection denial after failed cleanup: retain runtime denial, retry
   the existing durable revocation intent even when no visible members remain,
   and prove offline recreation cannot restore obsolete access after recovery.
2. Tile cancellation under producer backpressure: hold the admitted transport
   workers, cancel a plan larger than the bounded queue, and require engine
   idleness to wait for those workers before terminal cleanup.
3. Android native response deadline: prove a trickling successful body cannot
   occupy the native executor beyond the request budget when JavaScript timers
   are unavailable; use a native deadline and cancellation boundary if
   confirmed.

Five actionable findings were confirmed:

- **P1 — revoked access restored by a retry:** the baseline
  `GisGeometryCoordinator.ts:87` reread an older disk catalog after startup
  cleanup and a subsequent revocation write failed. Retain accepted runtime
  catalog authority on load retries; reset still clears it at account changes. A
  real IndexedDB regression holds stale membership and coordinates on disk and
  verifies neither reappears after retry. Primary repeated its failing-first run
  against `c20cb42`: `/tmp/speleodb-fresh-authority-red.log`.
- **P2 — repeated denial abandoned cleanup:** baseline coordinator line 315
  returned before replaying pending tombstones when no runtime members remained.
  Explicit 401/403 retries now persist the existing denial. Tests verify durable
  catalog/detail cleanup and an offline restart after storage recovers.
- **P2 — startup cleanup was not independent:** baseline coordinator lines 93–95
  stopped before removing offline areas when detail deletion failed. Startup and
  normal revocation now share a helper that attempts both independent steps,
  while account cancellation still prevents stale mutation. The regression
  verifies the callback despite deletion failure and later valid-item recovery.
- **P1 — tile workers escaped cancellation ownership:** a producer cancelled
  while its 64-task queue was full skipped the worker join. `waitForIdle()`
  could finish while six admitted requests still ran, allowing logout cleanup or
  additional replacement workers. The engine now joins workers before terminal
  cleanup and waits for predecessors before admitting a successor. This is an
  inherited engine defect, exposed more frequently by incremental GIS planning.
  A deterministic engine test holds the actual engine's transport dependency;
  repository and area-service suites complement that worker-ownership seam.
- **P2 — Android streaming responses escaped the deadline:** socket read
  timeouts restart as bytes arrive, while a background WebView may pause its
  JavaScript watchdog. A real native loopback regression streamed an unfinished
  200 body beyond the request deadline and failed before correction. The request
  now has a native watchdog plus monotonic checks; terminal paths release it.

Each correction received an independent read-only cross-review. No additional
confirmed findings remained in reviewed source authority, tile math,
standardized catalog, transport isolation, validation, visibility, camera intent
or layout. No public API, schema, menu design, entry budget or dependency
changes are made.

## Verification results

- Focused coordinator/cache: 52 tests passed after four failing-first cases.
- Focused engine/repository/area service/tile coordinator: 86 tests passed.
- Focused Android transport: 8 tests passed after the streaming regression
  failed.
- Primary combined focused run:
  `npm run test.unit -- --run src/controllers/GisGeometryCoordinator.test.ts src/services/GisGeometryCacheService.test.ts src/services/OfflineMapSyncEngine.test.ts src/services/OfflineMapSyncEngine.repository.test.ts src/services/DownloadAreaService.test.ts src/controllers/TileCoordinator.test.ts --no-file-parallelism`:
  6 files / 138 tests passed. Log: `/tmp/speleodb-fresh-focused.log`.
- `make ci`: all 134 files / 2,255 tests passed, zero skips; quality inventory,
  ESLint, TypeScript and production build passed. Coverage: 91.07% statements,
  83.62% branches, 93.15% functions, 93.23% lines. Entry bundle 471.35 kB
  remains below the unchanged 750 kB budget. Log: `/tmp/speleodb-fresh-ci.log`.
- `npm run test:browser` after the documented synchronization correction: all 90
  tests passed, zero retries, Chromium and WebKit. Log:
  `/tmp/speleodb-fresh-browser-final.log`.
- `npx cap sync android`, then Android Studio JBR, Android SDK and an inert
  Sentry test DSN with
  `./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:compileDebugAndroidTestJavaWithJavac --console=plain`:
  passed, 650 tasks; 22 JVM tests, zero failures/errors/skips, lint and APK
  build, instrumentation compiled. Logs: `/tmp/speleodb-fresh-android-sync.log`
  and `/tmp/speleodb-fresh-android.log`. `adb devices` found no device, so
  Android instrumentation was not executed.
- `npx cap sync ios` followed by
  `SENTRY_DSN_IOS=https://public@example.invalid/1 xcodebuild -project ios/App/App.xcodeproj -scheme SpeleoDB -destination 'platform=iOS Simulator,id=BA0876D4-75BB-478F-8A7B-418E080EC33E' -derivedDataPath /tmp/speleodb-gis-review-native-isolated -parallel-testing-enabled NO -disableAutomaticPackageResolution -skipPackageUpdates -collect-test-diagnostics never test`:
  signed simulator build and all 27 tests passed, zero failures, exit 0. Log:
  `/tmp/speleodb-fresh-ios.log`; result bundle:
  `/tmp/speleodb-gis-review-native-isolated/Logs/Test/Test-SpeleoDB-2026.09.17_11-38-15--0500.xcresult`.
  One existing loopback-test QoS priority-inversion diagnostic appeared; it is
  test-helper scheduling evidence, not a production assertion failure. Optional
  Xcode diagnostics collection was disabled, no tests were disabled.
- Both native syncs produced only the intended Android request/test diffs
  against `c20cb42`; no generated native changes are included.
- `npx prek run -a`: passed every applicable hook, including ESLint, lockfile
  consistency, TypeScript and production build. The initial run formatted this
  report; the clean full run exited 0. Log:
  `/tmp/speleodb-fresh-prek-final.log`. Hooks for absent file types are
  inapplicable, not skipped tests. Final report-only completion edits were
  format-checked.
- Final source and test files match the verified checkout byte-for-byte. The
  review-owned commit is based on `c20cb42`; unrelated Sentry manifests remain
  unstaged. Temporary copied integration credentials were removed after checks.

Full tests are run with committed dependencies in
`/tmp/speleodb-gis-deep-verification`. Unrelated Sentry manifest edits remain
outside this change and outside the successful-build claim. Physical Android
disconnect/background scheduling and physical iOS/WebView behavior require
device evidence; JVM, browser and simulator tests do not establish those
guarantees.

### Browser verification interruption

The first full browser run passed 89/90 tests. WebKit's existing real compass
mouse-drag test observed no distance-scale change (`offline-maps.spec.ts:664`).
The trace is preserved and the transport/UI reviewer is investigating the
interaction and synchronization boundary. Do not accept a rerun alone, add
retries/sleeps, or relax the movement assertion to conceal this failure.

The preserved failed trace is `/tmp/speleodb-fresh-compass-failure-trace.zip`.
Diagnostics recorded WebKit dispatching a 12-step drag in 8 ms, while Chromium
spread the same call over about 200 ms. MapLibre applies these changes in its
render task queue. The test now advances each of its existing 12 moves through
`requestAnimationFrame` before release; distance, movement threshold and heading
assertions are unchanged. Focused Chromium/WebKit checks both passed
(`/tmp/speleodb-compass-focused-after.log`). Diagnostic burst and paced gestures
both moved the map: the precise original lost-drag mechanism remains unproven.
This is test synchronization, not a claimed production compass fix. No retries,
arbitrary sleeps or relaxed assertions were introduced. Temporary diagnostic
specs were removed. The subsequent full browser suite passed all 90 tests with
zero retries.
