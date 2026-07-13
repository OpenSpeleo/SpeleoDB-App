# Sync foreground responsiveness and diagnostics

## Confirmed root causes

1. `ProjectSyncCoordinator.sync()` keeps `syncStatus === 'syncing'` until
   offline-map coverage collection and durable plan admission complete.
2. `mapDataRevision` publishes only at terminal completion, so newly durable
   project GeoJSON is not reread while later overlay, GPS, and tile phases run.
3. Dashboard project-map loading reads every project sequentially and publishes
   only the final aggregate. One slow record prevents every earlier project from
   becoming visible.
4. Offline-map source collection rereads eligible project records sequentially
   and performs source conversion on the WebView thread before the planner
   worker can start.
5. Timing calls use `console.info`, while Capacitor is intentionally configured
   with `loggingBehavior: "none"`. JavaScript console statements therefore are
   not redirected into Xcode or Android Studio device logs. Enabling Capacitor
   bridge logging would expose plugin arguments and is not acceptable.

## Delivery units

### PERF-001 — Responsive data publication and background map preparation

- [x] Add a coordinator regression proving the foreground sync resolves and
      publishes remote data while offline-map preparation remains deferred.
- [x] Add a Dashboard regression proving the first durable project becomes
      visible while a later project read remains pending.
- [x] Add a TileCoordinator regression proving project-sync map preparation is
      admitted after the foreground completion/paint boundary and remains
      cancellable on logout or supersession.
- [x] Execute the focused tests and record the expected failures.
- [x] Publish map revisions after durable project GeoJSON completion.
- [x] Complete foreground sync after project GeoJSON, overlays, and GPS have
      durably published; queue offline-map preparation on its own cancellable
      lifecycle without awaiting it.
- [x] Incrementally publish Dashboard project records and cooperatively yield
      between records so React/MapLibre can paint and accept input.
- [x] Replace serialized offline-map project-record reads with bounded
      concurrency and yield before CPU-heavy source conversion.
- [x] Update project-sync, Settings, map-data, and offline-map architecture
      docs.
- [x] Run focused concurrency/storage/UI tests and repository verification.
- [x] Commit as `[Fix] Keep synchronization responsive` and inspect it before
      starting PERF-002. Do not push.

### PERF-002 — Safe native timing visibility

- [x] Add TypeScript contract tests proving timing diagnostics contain only the
      fixed allowlisted fields and still reach the browser console.
- [x] Add iOS and Android native tests for rejecting unknown phases/statuses and
      formatting accepted timing records.
- [x] Execute the focused tests and record the expected failures.
- [x] Add a narrow first-party native performance-diagnostic plugin that writes
      only validated sync timing fields to OS logging while global Capacitor
      bridge logging remains disabled.
- [x] Route project-sync and offline-map timings through the shared diagnostic
      reporter and document Xcode/Logcat filtering instructions.
- [x] Run web, Android, and iOS verification applicable to the new bridge.
- [x] Commit as `[Fix] Surface sync timings in native logs` and inspect it. Do
      not push.

## Verification gates

- Focused red/green controller, hook, native-plugin, cancellation, and overlap
  tests.
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `API_TEST_ENABLED=false npm run test:ci`
- `npm run quality:inventory`
- Android unit tests, lint, and Debug compilation.
- iOS XCTest and simulator Debug compilation where the local toolchain permits.
- Button/MapLibre hard-rule scans and `git diff --check`.
- Explicit staged/unstaged inspection before each commit.

## Review

### PERF-001 TDD evidence

- Red command:
  `npm run test.unit -- --run src/controllers/SpeleoDBController.test.ts src/pages/dashboard/useDashboardMapData.test.ts src/controllers/TileCoordinator.test.ts -t "publishes validated project map data before later remote phases finish|completes foreground sync before offline-map preparation starts|publishes an available project while a later project cache read is pending|reads project coverage records with bounded concurrency"`.
- Red result: all 4 selected tests failed at the owning seam. Map revision was
  still `0`, planning observed an unsettled foreground promise, the first
  project remained hidden, and source collection admitted `1` read instead of
  the bounded `4`.
- Green selected result: 4/4 pass.
- Green affected suites:
  `npm run test.unit -- --run --no-file-parallelism src/controllers/SpeleoDBController.test.ts src/pages/dashboard/useDashboardMapData.test.ts src/controllers/TileCoordinator.test.ts`
  — 218/218 pass.

### PERF-001 implementation result

- The map revision publishes immediately after validated project GeoJSON is
  durable, before overlays and GPS finish.
- `syncStatus` and the Settings promise complete after project, overlay, and GPS
  data publication. The tile phase reports `tile_prefetch_queued`; source
  collection and plan admission run from a later cancellable task.
- Dashboard uses four bounded project readers, publishes each ready record, and
  yields before CPU conversion and after publication. Overlay records also
  publish progressively with cooperative yields.
- Offline-map project source reads use four-way bounded concurrency, source
  conversion yields to rendering/input, and plan enumeration remains in its
  worker. Logout/supersession cancels queued work before admission.
- Async map state is keyed by project/revision generation, avoiding a
  synchronous effect reset and its extra/cascading render. See
  `tasks/lessons/generation-keyed-async-state.md`.

### PERF-001 verification

- `npm run lint` — pass.
- `npm run typecheck` — pass.
- `npm run build` — pass; 613 modules transformed.
- `API_TEST_ENABLED=false npm run test:ci` — pass: 115 files passed, 2 skipped;
  1,903 tests passed, 13 skipped. Coverage: 90.33% statements, 82.08% branches,
  92.78% functions, 92.42% lines.
- `npm run quality:inventory` — pass; all 584 tracked files classified.
- `ProjectSyncCoordinator` 585 lines; `TileCoordinator` 594 lines.
- Button background hard-rule scan — no matches.
- MapLibre source ownership — no layer/source code changed; complete map tests
  remain green.
- `git diff --check` — pass.
- Native runtime responsiveness remains a physical-device evidence gate. This
  delivery changes shared TypeScript behavior and compiles into the production
  bundle; PERF-002 owns native device-log visibility and native compilation.

### PERF-002 TDD evidence

- TypeScript red command: `npx vitest run src/utils/performanceTiming.test.ts`.
  Result: 3/3 failed because `createPerformanceTimingLogger` did not exist.
- Android red command:
  `./gradlew testDebugUnitTest --tests org.speleodb.app.PerformanceTimingLogFormatterTest`.
  Result: Java compilation failed with seven missing
  `PerformanceTimingLogFormatter` symbols.
- iOS red command:
  `xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/speleodb-perf-diagnostics-red build-for-testing CODE_SIGNING_ALLOWED=NO`.
  Result: the new XCTest target failed to compile because
  `PerformanceTimingLogFormatter` did not exist.
- iOS bridge red command: focused simulator execution of
  `AppBridgeViewControllerTests/testPerformanceDiagnosticsPluginIsRegisteredWithLoadedBridge`.
  Result: the assertion failed because compiling the plugin did not register it
  with this app's explicit first-party bridge.
- Green focused web result: 3/3 pass. The native record excludes `reason`, the
  browser path avoids the plugin, and a rejected native diagnostic cannot fail
  synchronization.
- Green Android result: 3/3 formatter tests pass through `testDebugUnitTest`;
  accepted and skipped durations format consistently and unknown/invalid fields
  are rejected.
- Green iOS result: the app and XCTest bundle compile, then 3/3 focused tests
  pass on the iOS 26.5 iPhone 17 Pro simulator. The simulator spent 138 seconds
  booting/installing; the three tests executed in 0.004 seconds.

### PERF-002 implementation result

- Browser timings use `console.log`, making them visible in WebView developer
  tools without relying on the filtered `info` level.
- Native builds forward only `scope`, `runId`, `phase`, `durationMs`, and
  `status` to an explicitly registered first-party plugin. iOS writes category
  `SpeleoDBPerformance` through OSLog; Android uses the same Logcat tag.
- Native formatters own closed value allowlists. Optional phase reasons and all
  project, GPS, landmark, network, geometry, and credential data stay outside
  the native API.
- Capacitor `loggingBehavior` remains `none`; broad bridge logging was not
  enabled.

The iOS registration correction exposed a reusable native-boundary pattern; see
`tasks/lessons/native-plugin-registration.md`.

### PERF-002 verification

- `npm run lint` — pass.
- `npm run typecheck` — pass.
- `npm run build` — pass; 613 modules transformed.
- `API_TEST_ENABLED=false npm run test:ci` — pass: 116 files passed, 2 skipped;
  1,906 tests passed, 13 skipped. Coverage: 90.34% statements, 82.09% branches,
  92.79% functions, 92.43% lines.
- `npm run quality:inventory` — pass; all 589 tracked files classified.
- `./gradlew testDebugUnitTest lintDebug assembleDebug` — pass; 739 Gradle tasks
  completed or were up to date.
- iOS generic-simulator `build-for-testing` — pass for the app and XCTest
  bundle.
- iOS formatter XCTest — 3/3 pass on iOS 26.5 iPhone 17 Pro simulator.
- iOS production-bridge registration XCTest — 1/1 pass on the same simulator.
- Button background hard-rule scan — no matches.
- MapLibre code was not changed; source-ownership tests pass in the complete web
  suite.
- Generated Android/iOS web assets were inspected and produced no tracked diffs.
- `git diff --check` — pass.
- Physical-device receipt of an OSLog/Logcat line remains the final device
  evidence gate. The compiled formatter, plugin registration, and live iOS
  bridge resolution are automated; install a new native build before testing
  because an older installed shell does not contain this plugin.
