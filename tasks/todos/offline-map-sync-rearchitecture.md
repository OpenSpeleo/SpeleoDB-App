# Offline Map Synchronization Re-architecture

## Goal

Replace the serialized per-target tile-prefetch pipeline with one canonical
offline-map plan, bounded parallel downloading, layer-generation ownership, and
event-driven progress that never waits for durable checkpoints.

## Implementation gates

- [x] Record deterministic current-tree and `d556d235` baseline behavior for
      cached startup, layer activation, slow downloads, retries, cancellation,
      and restart.
- [x] Add the v7 plan, plan-chunk, generation, membership, and session schema,
      then the additive v8 coordinate-staging store, without deleting or
      invalidating existing payloads or v7 records.
- [x] Migrate legacy ownership incrementally by layer and treat missing fetch
      timestamps as fresh from migration time.
- [x] Build one worker-owned canonical `{z,x,y}` plan for projects, landmarks,
      stations, and local/server GPS paths.
- [x] Make the stable denominator `coordinateCount * enabledLayerCount` and
      reuse the canonical plan when enabling a layer.
- [x] Replace the serial downloader with a six-worker, URL-deduplicated pool
      whose retry delays never block ready work.
- [x] Keep tile payload/metadata/capacity/ownership commits atomic while
      removing JavaScript-wide cache mutation serialization.
- [x] Separate live per-tile progress from durable session checkpoints and
      publish React snapshots at paint cadence through a dedicated store.
- [x] Switch `TileCoordinator`, controller/context, and Settings to the new
      engine; remove the old per-target prefetch hot path.
- [x] Preserve cache-first runtime reads, the 180-day freshness policy, rolling
      force refresh, storage consent, cancellation, and logout cleanup.
- [x] Update architecture, offline-mode, layer, Settings, sync, and index docs;
      capture the reusable serialized-hot-path lesson.

## Verification gates

- [x] Planner/worker tests prove all source kinds, dateline handling, dedupe,
      immutable totals, and plan reuse.
- [x] Fake-IndexedDB tests prove v6-to-v7 preservation, incremental migration,
      generation commit/rollback, concurrent capacity writes, stats, and
      database recovery.
- [x] Engine tests prove six-way concurrency, per-tile progress, retry
      classification/head-of-line avoidance, deadlines, offline pause/resume,
      cancellation, late completion rejection, and restart recovery.
- [x] Coordinator/context/Settings tests prove one total transition, stable
      `N*M`, overall/per-layer progress, failure-aware completion, refresh
      gates, and no global per-tile notifications.
- [x] Existing MapLibre cache-first protocol tests remain green.
- [x] Focused suites, lint, typecheck, production build, and `make ci` pass.
- [x] Capacitor sync diffs are inspected; Android and iOS build/tests pass.
- [x] Physical Android/iOS slow-network and airplane-mode evidence is recorded,
      or explicitly listed as a release limitation.

## Baseline and performance evidence

To be recorded before replacement and repeated after integration:

- current tree and `d556d235` deterministic scheduler/concurrency behavior;
- unchanged fresh-plan reads/writes/network counts;
- 1,000-tile controlled-latency completion and maximum concurrency;
- progress event gaps, retry queue behavior, and cancellation latency;
- physical-device warm-tile, cached-viewport, plan-startup, and UI-publication
  p95 measurements.

## Review

### Baseline and performance findings

- `git show d556d2356915bb510a1fc0764a6d020d1718279d:src/services/TilePrefetchService.ts`
  and the pre-replacement `HEAD` service both have one `runningPromise`, one
  `processQueue()` loop, and one awaited fetch at a time. The newer service also
  serialized job persistence and ownership work around that single worker.
- At deterministic 100 ms transport latency, the serial lower bound for 1,000
  tiles is 100 seconds. `OfflineMapSyncEngine.test.ts` proves the new engine
  holds six active workers and completes the same 1,000 tiles in 167 waves, or
  16.7 simulated seconds: 5.99x the serial baseline before IndexedDB and UI
  bookkeeping costs.
- The fresh active-generation test proves the unchanged-plan path performs no
  URL audit, generation write, or network request. The repository integration
  test continuously commits 300 real fake-IndexedDB payload/membership writes.
- The production build keeps the planner in a 5.99 kB worker chunk and the
  synchronization engine in a lazy 11.70 kB chunk, so the redesign does not
  inflate initial application JavaScript.

### Verification results

- Focused authoritative suites: 14 files / 386 tests passed before final
  cleanup; final engine/repository/controller subsets also passed, including 12
  engine/storage integration tests and 186 controller tests.
- `make ci` (with network access for live stage integration tests): 106 files,
  1,772 tests passed; statements 88.67%, branches 81.74%, functions 91.63%,
  lines 90.73%; quality inventory, ESLint, TypeScript, and production build all
  passed.
- `npx cap sync`: passed; inspection found no tracked Android or iOS changes.
- `android/gradlew testDebugUnitTest assembleDebug`: passed, 492 tasks.
- Generic iOS device build with Xcode 26.5 SDK: passed.
- Signed iPhone 17 Pro / iOS 26.5 simulator `AppTests`: 9 of 9 passed. An
  earlier unsigned run correctly failed Keychain tests with
  `errSecMissingEntitlement`; it was rerun with simulator ad-hoc signing.
- `git diff --check` and the hard button-background scan passed.

### Limitations and device evidence

No physical Android or iOS device is attached to this environment. Therefore
warm MapLibre p95 latency, fully cached viewport p95, foreground publication
p95, slow-network interruption, airplane-mode persistence, force-quit recovery,
storage blocking, and layer switching still require the planned release-device
matrix. Automated tests establish ordering, concurrency, durability, and the 50
ms publication design invariant, but they are not a substitute for those
physical-device measurements.

No commit was created as part of this task, so there is no implementation commit
reference to record. The historical comparison baseline is
`d556d2356915bb510a1fc0764a6d020d1718279d`.

### Adversarial correction (2026-07-01)

The original review overstated bounded planning and source integrity. Its worker
built a lifetime set/array before emitting, the ready queue and URL set were
unbounded, partial source reads could still activate reduced coverage, and the
v7 manifest was not crash-staged. The correction adds acknowledged 2,048-row
worker streaming, unique v8 staging with manifest-last publication, 64-task
backpressure, strict source completeness, cryptographic revisions, corrupt-plan
rebuild/recovery/GC, and monotonic request ownership.

It also corrects cancellation through real IndexedDB transactions, background
refresh cache epochs, all-prior-generation activation, atomic layer disable,
per-layer no-data hashes, end-to-end response deadlines, and hostile RAF/
listener behavior. Historical command counts above describe the earlier tree;
they are not verification evidence for this corrected worktree. Current command
results and remaining physical-device blockers are recorded in
`tasks/todos/offline-map-adversarial-review.md`.
