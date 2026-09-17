# GIS Geometry independent review, round 3

## Objective and gates

Review the complete Geometry integration from `65d4b55` through `5f6433c`,
including the preceding corrections. The user explicitly requested a fresh
`review-agent` review, confirmed corrections, full tests, `prek run -a`, and a
commit. Previous green tests are not evidence for unexamined scenarios.

- [x] Fresh lead: authority, persistence, access/content ordering and session
      lifecycle, including real entry-point ordering.
- [x] Independent specialist reassigned to offline scheduling, tile ownership,
      union planning, cancellation and layer changes.
- [x] Independent specialist reassigned to native/web transport, validation,
      rendering, visibility and camera intent.
- [x] Primary: facade integration and evidence review; reproduce any confirmed
      failure, review the corrective plan and integrate minimal corrections.
- [x] Cross-review corrections; run focused owning-seam tests and full coverage,
      lint, TypeScript, production build, browser and applicable native checks.
- [x] Run `prek run -a`, inspect staged and unstaged diffs, and commit only
      review-owned changes with exact results and limits recorded below.

## Ownership and environment

Review domains have non-overlapping file ownership; primary owns facade,
documentation, repository-wide verification and commit. One newly created lead
and two specialists reassigned to different domains independently inspect the
current source. Findings require a concrete production trigger and smallest
reasonable correction; no speculative changes or style-only refactoring.

At review start, the main checkout had unrelated Sentry changes in
`package.json` and `package-lock.json`. They were preserved by this review and
later disappeared without an agent edit; both manifests now match the committed
versions and the verification checkout byte-for-byte. Verification runs in
`/tmp/speleodb-gis-deep-verification` with those dependencies and current review
code. Physical-device behavior requires separate evidence.

## Findings and verification

Corrective plans reviewed before implementation:

1. **P2 — stale restoration crosses a newer accepted detail.** After an initial
   cache-load failure, online refresh can succeed and start background details.
   A user detail request retries restoration through the facade's normal
   load-then-ensure sequence. An awaited cache read can finish after a newer
   detail commit and publish older items/records. Serialize restoration through
   the existing commit lane; prove ordering with real IndexedDB and deferred
   cache-read completion. No network request is moved into that lane.
2. **P2 — discarded HTTP error body retains transport resources.** The web
   strict-JSON path returned non-success status without consuming/cancelling its
   body, then cleared its deadline. Explicitly cancel the discarded body without
   awaiting cancellation, preserve the received status, and consume cleanup
   rejection. Real Response/ReadableStream tests cover 403, 404 and 500 with an
   open body and delayed cancellation completion.

Independent offline inspection found no additional actionable issue in source
freshness, shared union math, capacity isolation, provider activation, worker
ownership, logout draining or repository ordering. This is a bounded review
conclusion, not a claim that hardware/background behavior was verified.

## Focused evidence

- Restoration regression failed before the fix with runtime revision 1 instead
  of accepted revision 2. Real IndexedDB backed the catalog and detail reads;
  controlled completion ordering exposed the publication race. Coordinator/cache
  suites passed 53 tests after correction.
- Three real Response/ReadableStream tests failed before body cancellation was
  added. The final HTTP suite passed 21 tests, including pending cancellation
  and rejection. Stream tests own the cleanup contract; mocked fetch does not
  prove browser TCP teardown.
- No new native, parser, rendering, visibility or zoom defects were confirmed.
  Authority and transport corrections received independent cross-review; offline
  paths were reviewed without changes. Root traced facade entry points and
  cleanup callbacks.

## Full verification

- Combined focused coordinator/facade/cache/HTTP/area-service run:
  `npm run test.unit -- --run src/controllers/SpeleoDBController.test.ts src/controllers/GisGeometryCoordinator.test.ts src/services/GisGeometryCacheService.test.ts src/services/HttpClient.gis.test.ts src/services/DownloadAreaService.test.ts --no-file-parallelism`:
  5 files / 335 tests passed. Log: `/tmp/speleodb-review-round3-focused.log`.
- `make ci`: all 134 files / 2,260 tests passed with zero skips; inventory,
  ESLint, TypeScript and production build passed. Coverage: 91.07% statements,
  83.64% branches, 93.16% functions, 93.23% lines. Log:
  `/tmp/speleodb-review-round3-ci-final.log`.
- `npm run test:browser`: all 90 Chromium/WebKit tests passed, zero retries.
  Log: `/tmp/speleodb-review-round3-browser.log`.
- `npx cap sync android`, then Android Studio JBR, Android SDK and an inert
  Sentry DSN with
  `./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:compileDebugAndroidTestJavaWithJavac --console=plain`:
  build/lint/instrumentation compilation passed (650 tasks). The unit task was
  initially up-to-date, so explicitly executed
  `./gradlew :app:testDebugUnitTest --rerun -x buildWebAssetsWithAndroidSentry --console=plain`:
  22 tests passed, zero failures/errors/skips. The second command reused already
  built assets; no tests were excluded. Logs:
  `/tmp/speleodb-review-round3-android.log` and
  `/tmp/speleodb-review-round3-android-tests.log`.
- `npx cap sync ios`, then
  `SENTRY_DSN_IOS=https://public@example.invalid/1 xcodebuild -project ios/App/App.xcodeproj -scheme SpeleoDB -destination 'platform=iOS Simulator,id=BA0876D4-75BB-478F-8A7B-418E080EC33E' -derivedDataPath /tmp/speleodb-gis-review-native-isolated -parallel-testing-enabled NO -disableAutomaticPackageResolution -skipPackageUpdates -collect-test-diagnostics never test`:
  signed simulator build and 27 tests passed, zero failures, exit 0. Log:
  `/tmp/speleodb-review-round3-ios.log`; result:
  `/tmp/speleodb-gis-review-native-isolated/Logs/Test/Test-SpeleoDB-2026.09.17_12-08-33--0500.xcresult`.
  Optional simulator diagnostics collection was disabled, no tests were
  disabled.
- Native sync/build checks introduced no tracked Android/iOS changes against
  `5f6433c`. `adb devices` listed no physical Android device; instrumentation
  was compiled, not run. No physical-device behavior is claimed.
- `npx prek run -a` in the main checkout passed every applicable hook, including
  ESLint, dependency consistency, TypeScript and the production build. The first
  run formatted this report; the clean run exited 0. Log:
  `/tmp/speleodb-review-round3-prek-final.log`. Hooks with no matching file
  types are inapplicable, not skipped tests. Report-only completion edits were
  checked separately for formatting.
- Final source/tests/manifests match the isolated verification checkout. This
  review-owned commit is based on `5f6433c`, with no dependency/native/schema
  changes. Copied integration credentials were removed after checks.

No dependency or schema changes are included. Results apply to committed
dependencies in the isolated checkout; the main manifests now match them.

### Full-suite test correction

The initial full run passed 2,259/2,260 tests and failed the facade's repeated
landmark-signature test: it expected exactly one initial schedule but observed
two. A temporary diagnostic captured all scheduled plans after public idleness;
all had identical project/landmark rectangles, canonical revision and coverage
key (`/tmp/speleodb-review-round3-plan-diagnostic.log`). The engine double never
persists active generations, so call count cannot establish real rebuilds.

The test now awaits `waitForOfflineMapsIdle()` for each sync, requires both
rectangles, compares every repeated-sync plan and coverage key to the first
settled plan, and checks exact persisted area identity/metadata preservation.
Real DownloadAreaService tests continue to prove actual unchanged-plan reuse. No
retry, sleep, threshold relaxation or production tile change was added. The
temporary diagnostic file was removed; the subsequent complete CI run passed.
