# Unified offline download areas

Approved in conversation; user explicitly requested implementation. One
rectangular DownloadArea model represents manual areas, projects, landmarks,
tracks, and point overlays. Automatic areas are hidden and source-owned. Manual
areas download every layer, can be edited offline, and retain browsing tiles
when deleted. One JSON-compatible IndexedDB catalog shares the existing
downloader and payloads. No server/API changes or new dependencies.

## Implementation and verification gates

- [x] Add validated catalog, geographic adapters, transactional persistence.
- [x] Integrate area-scoped generations, cancellation, shared ownership,
      recovery, migration, and progress with the existing engine.
- [x] Correct landmark fold and mutation-triggered automatic coverage.
- [x] Add manual manager/editor, map overlays, Settings entry, offline layers.
- [x] Prove persistence, overlap, source completeness, and cancellation at
      production seams; prove UI and map contracts.
- [x] Run focused tests, lint/typecheck, full coverage suite, build, browser
      checks, and applicable native checks (details below).
- [x] Document architecture, UX, migration, performance, and device gates.
- [ ] Release gate: physical iOS and Android device verification for gestures,
      airplane-mode rendering, storage pressure, app kill/restart, and
      foreground transitions. No connected physical device was available for
      this run.

## Review

Analysis and final design:
[Offline download areas](../../docs/offline-download-areas.md). Related
settings, map layers, cache, coordination, and panel-state documentation were
aligned with the new behavior.

Planning audit: 261 tests passed across TileCoordinator, GpsTrackCoordinator,
SpeleoDBController, OfflineMapPlanner, tilePrefetchPlanner, and the engine's
repository integration suite. This was baseline evidence, not feature
validation.

Implementation verification on 2026-09-16:

| Command                                                                                                                                                                                                    | Result                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run lint`                                                                                                                                                                                             | Passed; no diagnostics                                                                    |
| `npm run typecheck`                                                                                                                                                                                        | Passed                                                                                    |
| `npm run build`                                                                                                                                                                                            | Passed; existing startup, initial-graph and lazy-chunk budgets remain enforced            |
| `npm run test.unit -- --run src/services/DownloadAreaService.test.ts src/controllers/TileCoordinator.test.ts src/controllers/SpeleoDBController.test.ts`                                                   | 228 tests passed, including production source folding and real engine/IndexedDB ownership |
| `npm run test:ci`                                                                                                                                                                                          | 122 files, 1,988 tests passed; all coverage thresholds passed                             |
| `npm run test:browser`                                                                                                                                                                                     | 30 passed, WebKit + Chromium, no retries                                                  |
| `npm run build:native:android:assets`                                                                                                                                                                      | Passed; current web assets copied into Android                                            |
| `./gradlew testDebugUnitTest lintDebug assembleDebug` in `android/`                                                                                                                                        | Passed                                                                                    |
| `xcodebuild -project ios/App/App.xcodeproj -scheme SpeleoDB -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/speleodb-offline-areas CODE_SIGNING_ALLOWED=NO build` | Passed                                                                                    |
| `git diff --check`                                                                                                                                                                                         | Passed                                                                                    |
| `rg 'app-btn[^"\n]*bg-' src --glob '*.tsx'`                                                                                                                                                                | No matches                                                                                |

Final full-suite coverage: statements 90.70%, branches 82.72%, functions 92.95%,
lines 92.86%. Existing thresholds were not changed. Tests cover manual/automatic
sharing, all-layer replacement, superseded and deleted intent, offline save /
refinement, restored pending landmarks, stable source identity, legacy-pin
retirement including empty reconciliation, foreground resume, startup recovery
ordering, signout, wrapped geometry, source injection, navigation protection and
resize preservation.

Browser tests use compiled production code, actual IndexedDB and MapLibre, a
fixture API/tile transport and a narrowly emulated native vault bridge. They
exercise persistence through reload, all-layer completion, hide/show,
refinement, delete, short-screen controls, Settings navigation and offline
save/restart / explicit reconnect. Screenshots are under
`test-results/offline-maps-*`; manager and short-screen selection captures were
inspected. Headless Chromium's known WebGL ReadPixels driver diagnostic is
distinguished from application warnings.

An initial production build exposed eager loading of storage/planner code into
the login bundle. Those dependencies now load on demand; budgets were preserved.
An initial coverage run exposed missing UI seam coverage; manager/editor and
Source-injection tests were added rather than lowering thresholds. Browser tile
fixtures were corrected to valid PNGs and API response shapes, and final browser
runs assert no unexpected application console errors in the online lifecycle.

Native source/plugins were unchanged. Native builds check packaging and compile
compatibility; browser and fake-IDB tests cannot establish real WebView
gestures, OS suspension, physical storage pressure, or provider coverage. Those
remain the explicit device release gate above. No deployment or commit was made;
changes are in the working tree for review. No unrelated staged work was
included.

### Native test limitation

An iOS XCTest run was attempted with normal simulator signing. The existing
`SpeleoDB` scheme has no test action. A temporary validation scheme exposed a
second pre-existing configuration issue: `AppTests.TEST_HOST` still points at
`App.app/App`, whereas the application target builds `SpeleoDB.app/SpeleoDB`.
The temporary scheme was removed; no native configuration changes are included.
Therefore iOS native unit tests were **not** executed. Native compile validation
passed, and the new behavior's automated tests run at its TypeScript, IndexedDB,
MapLibre and browser seams. Android unit tests/build/lint passed with current
web assets. `adb devices -l` reported no devices; Xcode's device list reported
the physical iPhone offline. Device checks remain outstanding.
