# Sync foreground responsiveness and diagnostics

## Confirmed root causes

1. `ProjectSyncCoordinator.sync()` keeps `syncStatus === 'syncing'` until
   offline-map coverage collection and durable plan admission complete.
2. `mapDataRevision` publishes only at terminal completion, so newly durable
   project GeoJSON is not reread while later overlay, GPS, and tile phases run.
3. Dashboard project-map loading reads every project sequentially and publishes
   only the final aggregate. One slow record prevents every earlier project
   from becoming visible.
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
- [x] Update project-sync, Settings, map-data, and offline-map architecture docs.
- [x] Run focused concurrency/storage/UI tests and repository verification.
- [x] Commit as `[Fix] Keep synchronization responsive` and inspect it before
  starting PERF-002. Do not push.

### PERF-002 — Safe native timing visibility

- [ ] Add TypeScript contract tests proving timing diagnostics contain only the
  fixed allowlisted fields and still reach the browser console.
- [ ] Add iOS and Android native tests for rejecting unknown phases/statuses and
  formatting accepted timing records.
- [ ] Execute the focused tests and record the expected failures.
- [ ] Add a narrow first-party native performance-diagnostic plugin that writes
  only validated sync timing fields to OS logging while global Capacitor bridge
  logging remains disabled.
- [ ] Route project-sync and offline-map timings through the shared diagnostic
  reporter and document Xcode/Logcat filtering instructions.
- [ ] Run web, Android, and iOS verification applicable to the new bridge.
- [ ] Commit as `[Fix] Surface sync timings in native logs` and inspect it. Do
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
  `npm run test.unit -- --run src/controllers/SpeleoDBController.test.ts
  src/pages/dashboard/useDashboardMapData.test.ts
  src/controllers/TileCoordinator.test.ts -t "publishes validated project map
  data before later remote phases finish|completes foreground sync before
  offline-map preparation starts|publishes an available project while a later
  project cache read is pending|reads project coverage records with bounded
  concurrency"`.
- Red result: all 4 selected tests failed at the owning seam. Map revision was
  still `0`, planning observed an unsettled foreground promise, the first
  project remained hidden, and source collection admitted `1` read instead of
  the bounded `4`.
- Green selected result: 4/4 pass.
- Green affected suites:
  `npm run test.unit -- --run --no-file-parallelism
  src/controllers/SpeleoDBController.test.ts
  src/pages/dashboard/useDashboardMapData.test.ts
  src/controllers/TileCoordinator.test.ts` — 218/218 pass.

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
