# Deep adversarial review of Geometries and shared tile integration

## Scope and verification plan

Review the entire change from `65d4b55` through `2b0a8df`, including the tile
regression correction. Prior green tests failed to expose a global source
barrier, so review production call paths and test observable invariants under
faults; test counts alone are not acceptance evidence.

- [x] Independently review authority/cache/account lifecycle, tile catalog and
      downloader lifecycle, transport/validation, and mounted UI behavior.
- [x] Map failure modes to owning production seams and existing evidence;
      reproduce actionable defects and document explicit remaining limitations.
- [x] Review corrective plans, implement minimal fixes with failing-first
      regression evidence, and update feature/architecture documentation.
- [x] Re-review fixes and their tests against the original scenarios and
      adjacent cancellation, persistence and concurrency cases.
- [x] Run full coverage tests, production build, Chromium/WebKit browser tests,
      applicable native tests and `prek run -a`; inspect diffs and commit.

## Ownership

Independent reviewers initially read only: geometry authority/cache/session;
tile source/catalog/engine lifecycle; transport/native validation and UI.
Primary owns façade integration, failure-mode inventory, plan integration,
repository-wide checks and final correctness claims. Edits will have explicit
non-overlapping ownership. Existing user authorization covers corrective work;
review does not require an additional approval gate.

## Failure-mode inventory

For each area, record invariant, concrete fault, authoritative test and result.

- Availability: empty/denied/missing/malformed collection; individual failed,
  delayed, invalid or oversized detail; healthy-source progress and explicit
  retry.
- Authority: stale revisions, unsafe revisions, list/detail arrival ordering,
  same-revision capability changes, revocation and regrant.
- Persistence: catalog/detail write/delete failure, interrupted writes, restart,
  retained area identity, legacy pins and shared memberships.
- Lifecycle: account switch/logout, caller cancellation, ignored abort, rapid
  resync, background/foreground, layer toggle and source cleanup races.
- Presentation: delayed show/hide/zoom, panel-aware bounds, style reload,
  errors/retry/offline state, safe text/colors and narrow navigation.
- Transport: credential isolation, redirects, deadline/body parsing,
  status/media handling, native bridge registration and cancellation cleanup.

## Review and evidence

### Confirmed findings and corrective plans

1. **P2: another source barrier remained.**
   `src/controllers/TileCoordinator.ts:481`: TileCoordinator published ready
   core sources only after every core read finished. A stalled GPS, project or
   overlay read still left healthy sources at 0/0. Three failing-first tests use
   the real area service, engine and IndexedDB, holding each dependency while
   asserting healthy GIS tile completion. The corrected readiness pump coalesces
   completed source types, preserves pending intent, publishes at most eight
   batches, and applies force refresh only to the final full snapshot.
   Independent cross-review checked cancellation, rejected promises,
   supersession and final authority.
2. **P2: interrupted writes could restore old permissions.**
   `src/controllers/GisGeometryCoordinator.ts:281`: A newer detail persisted
   before its catalog write failed could win a later atomic revision comparison
   and overwrite a fresh READ_ONLY response with old ADMIN metadata. Keep newer
   content, merge the accepted access fields, persist that combination, then
   publish. The failing-first regression checks runtime state, durable detail
   and catalog, and recreation using real IndexedDB.
3. **P2: revoke/regrant shared an obsolete task.**
   `src/controllers/GisGeometryCoordinator.ts:330`: Revocation left the old
   detail task registered for its UUID. A new legitimate grant deduplicated
   against work fenced by the old access epoch. Detach revoked task identity
   immediately while continuing to track running work through completion.
   Deferred 200/403/404/503 cases prove the replacement load succeeds before the
   old response and survives its late arrival, including an obsolete higher
   revision.
4. **P2: iOS discarded received denial status.**
   `ios/App/App/GisGeometryHttpClient.swift:90`: Completion-handler URLSession
   waited for an error body, so received 403/404 headers followed by a stalled
   body became a network timeout. Delegate-driven response handling captures
   status and cancels non-success bodies; one completion path releases state and
   preserves explicit caller cancellation. Native loopback before/after probes
   reproduce both denial statuses and distinguish an incomplete successful body
   timeout.
5. **P2: valid Unicode names rejected an entire collection.**
   `src/gisGeometry/validation.ts:18`: JavaScript string length counted UTF-16
   units while the backend counts Unicode code points. A valid 255-emoji name
   failed metadata parsing. Count code points and retain the 255-character
   boundary; the new regression fails before the fix.

All fixes preserve the existing GET routes, persisted schemas, shared tile
planner/engine, and rendering/UI design. No dependency upgrades belong to this
review. The hypothetical A→B→A hook visibility issue was rejected as a finding:
normal authentication creates new scopes and tears down the authenticated shell.
Project/GPS within-type conservative retention predates this feature; this
review removes cross-type blocking without changing those providers' contracts.

### Failure-mode evidence inventory

| Boundary                | Faults and required behavior                                                                                                                                       | Owning evidence                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Collection availability | Empty arrays succeed; 403/404/5xx, transport, HTML or malformed data cannot become authoritative emptiness or block healthy sources                                | Coordinator and controller GIS integration tests; real browser collection404/503 recovery                     |
| Detail availability     | Independent failed details retain saved identities; hidden loading never reveals an overlay; explicit refresh recovers                                             | GIS coordinator partial-source tests; TileCoordinator + DownloadAreaService; browser delayed details          |
| Source readiness        | Held GPS/project/overlay/GIS reads cannot block ready source types; final union contains all accepted rectangles                                                   | New real-engine TileCoordinator held-source cases; browser held GPS file and held GIS details                 |
| Content and access      | Older revisions cannot overwrite newer content; unsafe integers reject; same-revision capabilities update; every list/detail denial arrival order stays fenced     | Parser, real-IDB cache, coordinator access ordering and new interrupted-write recovery                        |
| Revocation/regrant      | Remove overlay and area, reject stale results, preserve unrelated work, allow legitimate replacement fetch                                                         | Coordinator new four-status regrant cases; facade tombstone/revocation; browser visible-access loss           |
| Persistence             | Failed catalog/detail writes preserve prior durable bytes; runtime denials survive failed cleanup; restoration repairs interrupted detail/catalog state            | CacheStore/GIS cache + coordinator real-IDB failure tests; facade interrupted-account/restart tests           |
| Tile ownership          | Source failure retains saved rows, manual/overlapping areas share union URLs, every enabled layer must finish before activation, legacy pins survive partial reads | DownloadAreaService real-engine/IDB tests; canonical geometry/planner tests                                   |
| Tile lifecycle          | Forced refresh, source supersession, ignored abort, logout draining, foreground changes, layer toggles, capacity consent, oversized geometry                       | Coordinator, area-service and OfflineMapSyncEngine suites; browser offline maps and layer stability           |
| UI intent               | Show/hide during delayed responses, latest tap owns zoom, panel exit/unmount prevents camera changes, full min/max bounds, safe colors/text                        | Mounted action-hook/Panel tests; Source injection tests; production canvas/browser checks                     |
| Transport               | Token-only cookie isolation, redirects, invalid routes, media/status parsing, deadlines, cancellation and bridge registration                                      | HttpClient GIS tests; Android JVM/bridge compile; iOS real loopback suite including held error/success bodies |
| Layout                  | Six/seven tabs, 44px targets, enlarged text, short viewport, 12px edge spacing                                                                                     | AppTabBar tests; Chromium/WebKit narrow-layout checks                                                         |

### Verification environment

An unrelated concurrent Sentry upgrade modified `package.json` and
`package-lock.json` during this review. Its React10.75/Capacitor-required10.69
mismatch blocks TypeScript and native asset builds. Preserve those user changes;
do not stage them. Verification checkout `/tmp/speleodb-gis-deep-verification`
starts from `2b0a8df` with committed dependencies and receives only review-owned
files. Installed committed dependencies using `npm ci --no-audit --no-fund`. No
check result is claimed for the incompatible dependency upgrade.

### Commands and results

- Failing-first tile evidence: `/tmp/deep-tiles-red.log` (three real-engine
  held-source tests), corrected focused pass `/tmp/deep-tiles-green.log`.
- Coordinator/cache correction: 48 focused tests and scoped lint passed;
  `/tmp/speleodb-deep-geometry-authority.log`.
- Combined coordinator, facade, cache and parser: 324 tests passed in the
  isolated checkout; `/tmp/speleodb-deep-combined.log`.
- Native denial before/after probe: `/tmp/speleodb-gis-review-native-probe.log`.
- `make ci`: passed inventory, ESLint, TypeScript, all 134 files / 2,250 tests
  with zero skips, unchanged coverage floors, and the production build.
  Coverage: 91.04% statements, 83.58% branches, 93.15% functions, 93.22% lines.
  Log: `/tmp/speleodb-deep-ci.log`. The initial isolated coverage attempt
  omitted the ignored integration-test environment and skipped 13 tests; the
  final full run restored the existing authorized test configuration and ran
  all 13.
- TypeScript caught a narrowing error introduced in the readiness-pump patch;
  its async failure check now uses a closure accessor. Corrected code passed the
  final full checks; no build-budget or coverage-threshold changes were made.
- `npx playwright test tests/browser/gis-geometry.spec.ts --grep 'GPS source is still pending'`:
  both new Chromium/WebKit cases passed against production assets.
- `npm run test:browser`: all 90 tests passed, zero retries. Log:
  `/tmp/speleodb-deep-browser.log`.
- `npx cap sync android`, then from `android/` with Android Studio JBR, Android
  SDK and inert test Sentry DSN:
  `./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:compileDebugAndroidTestJavaWithJavac --console=plain`:
  passed, 650 tasks, 21 JVM tests with zero failures/skips; instrumentation
  compiled, not executed. Log: `/tmp/speleodb-deep-android.log`.
- `npx cap sync ios` and a full signed simulator build/test used shared scheme
  `SpeleoDB`, destination `BA0876D4-75BB-478F-8A7B-418E080EC33E`, inert test
  Sentry DSN and `-parallel-testing-enabled NO`. All 27 tests passed, but Xcode
  hung in optional simulator diagnostics after the test run. Thread sampling
  identified `XCTHRunDestinationAllocator.collectSimulatorDiagnostics` /
  `simCtlDiagnose`. The final command exited 0:
  `xcodebuild -project ios/App/App.xcodeproj -scheme SpeleoDB -destination 'platform=iOS Simulator,id=BA0876D4-75BB-478F-8A7B-418E080EC33E' -derivedDataPath /tmp/speleodb-gis-review-native-isolated -parallel-testing-enabled NO -disableAutomaticPackageResolution -skipPackageUpdates -collect-test-diagnostics never test-without-building`.
  It ran the same built app and all 27 tests, zero failures/skips. Result:
  `/tmp/speleodb-gis-review-native-isolated/Logs/Test/Test-SpeleoDB-2026.09.17_10-34-28--0500.xcresult`;
  log `/tmp/speleodb-gis-review-ios-runner-final.log`. Two Thread Performance
  Checker QoS diagnostics concern loopback-helper/XCTest waits; no production
  assertion failed. Optional diagnostics were disabled, no tests were disabled.
- Both `cap sync` operations produced no unrelated tracked native changes in the
  verification checkout. Only the intended two Swift files differ.
- Final independent cross-review: no remaining actionable findings in the
  corrected code. `npx prek run -a` passed all applicable hooks, including
  ESLint, lockfile consistency, TypeScript and the production build. Log:
  `/tmp/speleodb-deep-prek.log`. Hooks for absent file types reported no files;
  these are not skipped tests. This report is committed with the corrective
  changes on top of `2b0a8df`.

Physical-device evidence is unavailable. `adb devices` lists no Android device;
simulator/browser evidence is distinct from physical WebView, background and
force-quit behavior. Test inventories establish the audited scenarios, not a
claim that every conceivable failure has been exhausted.
