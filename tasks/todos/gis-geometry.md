# GIS Geometry

## Approved design

Read-only GIS Geometry collection/detail GET integration. Dedicated Geometries
tab; list/map only; hidden after cold launch; name tap shows, closes the panel
after loading, and frames min/max bounds. All accessible geometries prepare
offline coordinates and 50 m-padded automatic download rectangles independently
of visibility. Reuse the existing map camera, cache, union planner, download
queue, and lifecycle boundaries. No editor or permissions-list requests.

## Implementation and verification gates

- [x] Canonical contract/fixtures, strict payload validation, shared rendering
      constants.
- [x] Token-only JSON GET transport on web/Android/iOS with native regression
      tests.
- [x] Scoped cache and coordinator: metadata first, four-request scheduler,
      deduplication, monotonic revisions, access freshness, durable revocation
      and cancellation.
- [x] Session scope migration, logout draining and account replacement cleanup.
- [x] Controller integration: independent metadata sync, dedicated snapshot and
      detail API.
- [x] GIS navigation/panel, race-safe toggle/zoom, shared panel presentation and
      map layers.
- [x] Automatic offline sources, complete-source barrier, targeted revocation
      and restart repair.
- [x] Authoritative service/cache/controller/component/offline regression suites
      pass.
- [x] Production Chromium/WebKit scenarios pass, including offline reload and
      narrow layouts.
- [x] Documentation and quality inventory updated.
- [x] Independent integrated review addressed.
- [x] Full `make ci` and final browser suite pass.
- [x] Applicable Android/iOS checks run; physical-device evidence or precise
      limitations recorded.

## Ownership

- Data/native specialist: GIS contracts, validation, API/transport,
  cache/coordinator, session scope and native cookie isolation.
- UI specialist: shared panel presentation, GIS panel/hook/layers, Dashboard/tab
  wiring and UI/browser tests.
- Offline specialist: automatic source type/adapter, tile collection barrier and
  transactional automatic-source removal, with real engine/repository tests.
- Primary: controller facade/sync integration, documentation, integration
  verification, and correctness review. Shared-file changes are coordinated
  explicitly.

## Verification baseline

Planning inspection: 33 tests passed across existing DashboardMapLayers,
downloadAreaGeometry and TileCoordinator suites. No new feature behavior was
implemented in the planning phase.

## Review

The user explicitly requested raising the recurring entry-bundle limit. Updated
the limit from 450,000 to 750,000 bytes; other bundle gates remain unchanged.
The user also requested removing the budget-driven lazy coordinator wrapper; GIS
uses direct integration with the existing controller.

The user requested matching Survey Projects presentation: menu/panel label
Geometries, upstream triangle-with-vertices icon, no zoom hint, side icon or
offline-preparation message. Background preparation and name-tap framing remain.

### Verification evidence so far

- Canonical/data/session/controller focused suites: 503 tests passed across 10
  files, including 214 façade cases and real IndexedDB lifecycle regressions.
  Final complete-suite evidence is recorded below when run.
- Revised UI focused suites: 225 tests passed across nine files. Geometries
  production browser scenarios passed 8/8 across Chromium and WebKit.
- `npm run test.unit -- --run src/services/HttpClient.gis.test.ts --no-file-parallelism`:
  17 tests passed, including explicit Cookie/Cookie2 rejection and native
  cancellation.
- Offline engine/source/coordinator suites: 67 tests passed, including admitted
  deferred work and sibling-failure draining at the authoritative idle boundary.
- Android JVM tests: 21 passed; instrumentation compilation and lint passed.
  Final normal full-assets build passed from `android/` with
  `JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' ./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug --console=plain`.
  Log: `/tmp/speleodb-gis-android-final.log`; all 643 tasks succeeded or were
  up-to-date, with no web-assets exclusion.
- Signed iOS XCTest on iPhone 18 Pro / iOS 27 simulator: 24 tests passed,
  including seven real localhost URLSession transport tests and bridge
  registration. `xcodebuild analyze build` also passed. Evidence:
  `/tmp/speleodb-gis-native-tests-signed.xcresult`,
  `/tmp/speleodb-gis-native-tests-signed.log`, and
  `/tmp/speleodb-gis-native-analyze-build.log`.
- Native checks use shared scheme `SpeleoDB` and simulator
  `BA0876D4-75BB-478F-8A7B-418E080EC33E`; XCTest runs with
  `-parallel-testing-enabled NO`.
- Quality classifications cover all 709 tracked/new files at this checkpoint.

No physical Android/iOS device was available. Android instrumentation has been
compiled but not executed; iOS runtime evidence is a signed simulator, not a
physical device. Builds and browser tests do not establish physical WebView,
airplane-mode or background/force-quit behavior.

### Review sequence

The user explicitly requested the `review-agent` skill after implementation,
followed by full tests and `prek`. Preliminary specialist review identified
failed-persistence revocation and crash-between-account-switch cleanup cases;
both were corrected with production-boundary regressions.

The fresh adversarial review identified two arrival orders of the same access
sequencing bug: an older list finishing first suppressed a newer detail denial,
or a newer denial finishing first was undone by the delayed older list. The
reviewed corrective plan uses the existing per-ID read sequence for successful
and denied reads, removes the global completion counter, and tests both 403/404
arrival orders plus a newer legitimate regrant. Corrective work passed 265
focused tests, lint, TypeScript and final diff review; no actionable findings
remain. Base commit: `65d4b55`; this review is included in the implementation
commit.

The reusable rule is recorded in
[access read ordering](../lessons/access-read-ordering.md).

### Final repository gates

- `make ci`: passed after the full review corrections. All 134 test files and
  2,212 tests passed; coverage is 90.92% statements, 83.46% branches, 93.02%
  functions and 93.14% lines, above unchanged repository floors. Quality
  inventory, ESLint, TypeScript and production build passed. Entry bundle:
  468.52 KB against the requested 750 KB limit. Log:
  `/tmp/speleodb-gis-make-ci.log`.
- `npm run test:browser`: final run passed all 82 Chromium/WebKit cases against
  the reviewed production build. Log:
  `/tmp/speleodb-gis-final-browser-mobile-gesture.log`.
- `npx prek run -a`: passed with no remaining changes after the initial Markdown
  formatting pass. All applicable sanity, formatting, ESLint, lockfile,
  TypeScript and production-build hooks passed. Log:
  `/tmp/speleodb-gis-prek-final.log`.

The final browser pass initially exposed one WebKit failure in the existing
offline-layer switching case: its synthetic mouse click left the dark layer
unchecked. The trace showed no checked state, but did not capture `ionChange`,
so it did not establish a production persistence failure. Instrumented
diagnostic runs preserved the rapid sequence. The mobile fixture now uses native
taps and asserts all four emitted switch intents before verifying the unchanged
union plan and durable layer state. No sleeps, retries, relaxed assertions, or
application changes were added for this correction.
