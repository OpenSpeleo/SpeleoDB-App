# Synchronization cache and publication performance

## Confirmed bottlenecks

1. A fresh 60-project response publishes a new project-array identity before
   GeoJSON reconciliation. Dashboard begins 60 project-record reads while
   `ProjectGeoJSONCoordinator` independently reads the same 60 records.
2. The subsequent map-data revision starts another Dashboard generation and
   rereads every record. In the worst overlap, one sync therefore issues up to
   180 IndexedDB reads of large GeoJSON values. IndexedDB structured-clones the
   full payload even when the coordinator only needs validation metadata.
3. Repeated Dashboard generations rerun depth attachment across every feature
   even when the immutable cached FeatureCollection object is unchanged.
4. Progressive publication can schedule one React state update and MapLibre
   reconciliation per project. Visibility is prompt, but 60 separate updates are
   unnecessary when several records become ready in the same rendering turn.
5. Overlay synchronization and GPS metadata synchronization are independent
   after project GeoJSON is durable, but the foreground path awaits them
   serially. Landmark collections also wait for all overlay writes despite
   having an independent endpoint and cache key.

A project-ID `Map` would reduce an O(projects²) lookup bounded at roughly 3,600
comparisons for 60 projects. That cost is negligible beside repeated IndexedDB
transactions, structured clones, full feature scans, React renders, and MapLibre
source updates, so it is not the first optimization target.

## Delivery units

### PERF-003 — Deduplicate validated project-record reads

- [x] Add fake-IndexedDB/service tests proving concurrent consumers share one
      authoritative record read and later readers reuse the immutable result.
- [x] Prove durable validated/quarantined/legacy writes replace the read-through
      entry only after commit, failed writes preserve the prior entry, and
      logout clears memory immediately.
- [x] Execute the focused tests and record the expected failures.
- [x] Add a bounded read-through/single-flight record cache inside
      `ProjectCacheService`; preserve per-caller cancellation checks without
      binding a shared IndexedDB read to the first caller's signal.
- [x] Reuse derived depth-enriched FeatureCollections by immutable source
      identity so revision-only reloads do not rescan coordinates.
- [x] Add a 60-project regression proving reconciliation plus subsequent map
      reads require one durable record read per project, not two or three.
- [x] Update cache, sync, map-data, and performance documentation.
- [x] Run focused and complete verification.
- [x] Commit as `[Fix] Deduplicate project cache reads`; inspect the commit and
      clean status before PERF-004. Do not push.

### PERF-004 — Batch ready map-data publication

- [x] Add a hook regression proving independently ready records coalesce into
      one publication turn while a slow record cannot block the first batch.
- [x] Execute and record the expected failure.
- [x] Coalesce ready project and overlay records per cooperative rendering turn
      without delaying the first available data or weakening stale-generation
      checks.
- [x] Preserve per-project commit gating and failure isolation.
- [x] Measure render/publication count with 60 immediate records.
- [x] Update Dashboard map-data performance documentation and verification.
- [x] Commit as `[Fix] Batch dashboard map publication`; inspect the commit and
      clean status before PERF-005. Do not push.

### PERF-005 — Parallelize independent foreground metadata sync

- [x] Add a coordinator regression proving overlay and GPS phases start together
      after durable project GeoJSON publication and the foreground result waits
      for both.
- [x] Add an overlay regression proving landmark collections do not wait for
      unrelated overlay cache writes.
- [x] Execute and record the expected failures.
- [x] Run overlay and GPS synchronization concurrently with independent timing
      records, cancellation, durable publication, and partial-failure behavior.
- [x] Fetch/persist landmark collections concurrently with overlay work.
- [x] Update phase-order and timing documentation.
- [x] Run focused and complete verification.
- [x] Commit as `[Fix] Parallelize sync metadata persistence`; inspect the
      commit and clean status. Do not push.

### PERF-006 — Prove and remove the wall-clock regression

- [x] Add a reproducible 60-project benchmark using representative large GeoJSON
      payloads and measure wall-clock latency, publication latency, retained
      heap ownership, and main-thread task duration.
- [x] Run the same benchmark against `1a8e3ef` and the current implementation;
      record raw samples, median, and worst result instead of operation-count
      proxies.
- [x] Add native-safe aggregate timings for project cache read, worker
      validation/structured-clone, durable cache write, Dashboard normalization,
      and Dashboard publication so the physical-device path reports the actual
      bottleneck without project identifiers or payload data.
- [ ] Reproduce the reported slowdown and add a failing regression at the seam
      that owns the measured cause.
- [ ] Remove or redesign any optimization that regressed wall-clock latency or
      retained large GeoJSON unnecessarily. Do not preserve a prior change
      merely because its operation counts improved.
- [ ] Prove the corrected implementation beats the `1a8e3ef` baseline without
      weakening durability, cancellation, validation, or progressive visibility.
- [x] Update performance documentation with measured results and limitations.
- [ ] Run focused, full web, native timing-formatter, and applicable native
      compilation verification.
- [x] Commit the green diagnostic boundary independently as
      `[Feature] Add granular sync wall-clock diagnostics`; inspect the commit
      and clean status before implementing the measured correction. Do not push.
- [ ] Commit the green correction independently as
      `[Fix] Remove sync performance regression`; inspect the commit and clean
      status. Do not push.

## Deferred architecture review

After PERF-003 through PERF-005, use physical-device timings to decide whether
60 per-project MapLibre sources remain material. A combined project source could
reduce source/layer count substantially, but it changes visibility, color,
depth, hit-testing, and source-ownership contracts. It must not be undertaken
without post-fix evidence showing MapLibre reconciliation—not storage—is still
dominant.

## Verification gates

- Focused fake-IndexedDB, cancellation, concurrent-read, durable-write,
  hook-publication, and coordinator-overlap tests.
- 60-project deterministic regression with backing-read and publication counts.
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `API_TEST_ENABLED=false npm run test:ci`
- `npm run quality:inventory`
- Button and MapLibre hard-rule scans.
- `git diff --check`, explicit staged/unstaged review, commit inspection, and
  clean status after every delivery unit.
- Native compilation only if shared native files or generated native assets
  change; physical-device timings remain the authoritative WebView performance
  gate.

## Review

### PERF-003 TDD evidence

- Red command:
  `npx vitest run src/services/ProjectCacheService.test.ts src/pages/dashboard/useDashboardMapData.test.ts -t 'single-flights and reuses validated project records|keeps cancellation caller-scoped|reduces two 60-project consumer passes|publishes a durable replacement|updates legacy and quarantine cache entries|reuses depth-enriched project data'`.
- Red result: same-project consumers performed 4 backing reads instead of 1; two
  concurrent and one later pass over 60 projects performed 180 reads instead of
  60; durable replacement readers returned the old backing value; and a
  revision-only reload created a second depth-enriched collection.
- Green focused result: 8/8 pass, including old-read/new-write ordering and
  pre-clear in-flight logout invalidation.
- Green owning suites: `ProjectCacheService.test.ts`,
  `useDashboardMapData.test.ts`, and `SpeleoDBController.test.ts` — 256/256 pass
  before the final repository gate.

### PERF-003 implementation result

- `ProjectGeoJSONRecordMemoryCache` owns a 64-entry LRU, concurrent
  single-flight reads, per-project write versions, and a logout generation.
- The first consumer performs the unavoidable IndexedDB read and structured
  clone; reconciliation and later Dashboard generations reuse its immutable
  record. The 60-project regression reduces deterministic backing reads from 180
  to 60.
- Validated, legacy, and quarantine writes publish memory only after durable
  completion. A failed write preserves the previous entry, and an older read
  cannot overwrite a newer committed record.
- Logout clears records and active-load admission before store deletion. A late
  old-generation read cannot repopulate memory.
- Depth-enriched FeatureCollections use weak identity memoization, eliminating
  repeated full-feature scans without adding another strong data owner.

### PERF-003 verification

- Focused cache/map suites — 62/62 pass, including LRU eviction and explicit
  invalidation at the memory-cache owning seam.
- `npm run lint` — pass.
- `npm run typecheck` — pass.
- `npm run build` — pass; 614 modules transformed.
- `API_TEST_ENABLED=false npm run test:ci` — pass: 117 files passed, 2 skipped;
  1,916 tests passed, 13 skipped. Coverage: 90.41% statements, 82.16% branches,
  92.83% functions, 92.50% lines.
- `npm run quality:inventory` — pass; all 599 files classified.
- Button background hard-rule scan — no matches.
- MapLibre declarations were not changed; source-ownership coverage remains
  green in the complete suite.
- `git diff --check` — pass.
- No native source or generated native asset changed, so native compilation is
  inapplicable to this TypeScript/cache delivery. Physical-device timings after
  installation remain the authoritative performance measurement.

### PERF-004 TDD evidence

- Red command:
  `npx vitest run src/pages/dashboard/useDashboardMapData.test.ts -t 'coalesces 60 ready records|loads other overlays while the landmarks cache read is pending'`.
- Red result: the production batcher did not exist, and the serial overlay
  loader admitted only the landmarks read while it was pending instead of all
  five overlay reads.
- Green selected result: 3/3 pass including the existing progressive-project
  invariant that a slow record cannot block an available project.
- Green owning suites: `useDashboardMapData.test.ts` and `Dashboard.test.tsx` —
  125/125 pass.

### PERF-004 implementation result

- A generation-aware rendering batcher accumulates ready entries in a `Map` and
  publishes one immutable batch after a cooperative main-thread yield.
- The four project readers keep bounded storage concurrency and progressive
  first data. Immediately ready records coalesce by worker wave, reducing the
  60-project worst case from 60 state/MapLibre publications to at most 15.
- All five overlay reads are admitted independently. Ready overlays coalesce and
  publish without waiting for a slow landmarks record.
- Unmount/revision staleness is checked before normalization and batch
  publication. Concurrent reads may settle, but cannot resurrect or warn about
  stale data.

### PERF-004 verification

- Focused batch/progressive-loading regressions — 3/3 pass.
- Owning Dashboard map-data suites — 125/125 pass.
- `npm run lint` — pass.
- `npm run typecheck` — pass.
- `npm run build` — pass; 614 modules transformed.
- `API_TEST_ENABLED=false npm run test:ci` — pass: 117 files passed, 2 skipped;
  1,918 tests passed, 13 skipped. Coverage: 90.42% statements, 82.16% branches,
  92.85% functions, 92.52% lines.
- `npm run quality:inventory` — pass; all 601 files classified.
- Button background hard-rule scan — no matches.
- MapLibre declarations were not changed; source-ownership coverage remains
  green in the complete suite.
- `git diff --check` — pass.
- No native source or generated native asset changed, so native compilation is
  inapplicable to this TypeScript/render-publication delivery. Physical-device
  timings after installation remain the authoritative performance measurement.

### PERF-005 TDD evidence

- Red command:
  `npx vitest run src/controllers/SpeleoDBController.test.ts -t 'starts overlay and GPS persistence together|loads landmark collections without waiting'`.
- Red result: GPS had not started while a deferred landmarks overlay was still
  pending, and landmark collections had not started while five deferred overlay
  cache writes were pending. Both regressions failed as expected (0/2 pass).
- Green selected command adds the progressive map-publication and ordered-timing
  characterizations; 4/4 pass.
- Green owning controller suite — 200/200 pass.

### PERF-005 implementation result

- Overlay and GPS metadata synchronization start from the same post-project
  GeoJSON durability boundary. The foreground promise observes both settlements
  before completing, so their wall-clock contribution is the slower branch
  rather than the sum of both branches.
- Each branch retains its owning durable publication boundary. Overlay revision
  publication does not wait for GPS; GPS publication remains inside the GPS
  coordinator after its cache commit.
- Concurrent measurements retain independent durations and are emitted in the
  stable overlay/GPS diagnostic order after both settle. Failure and abort
  outcomes remain explicit, and no rejection is left unobserved.
- Landmark-collection fetch/persistence now overlaps all five overlay paths and
  forwards the shared cancellation signal through its cache commit.

### PERF-005 verification

- Selected orchestration/timing regressions — 4/4 pass.
- Owning `SpeleoDBController.test.ts` suite — 200/200 pass.
- `npm run lint` — pass.
- `npm run typecheck` — pass.
- `npm run build` — pass; 614 modules transformed.
- `API_TEST_ENABLED=false npm run test:ci` — pass: 117 files passed, 2 skipped;
  1,920 tests passed, 13 skipped. Coverage: 90.41% statements, 82.03% branches,
  92.86% functions, 92.52% lines.
- `npm run quality:inventory` — pass; all 601 files classified.
- Button background hard-rule scan — no matches.
- MapLibre declarations were not changed; source-ownership coverage remains
  green in the complete suite.
- `git diff --check` — pass.
- No native source or generated native asset changed, so native compilation is
  inapplicable to this TypeScript/coordinator delivery. Physical-device timings
  after installation remain the authoritative performance measurement.

### PERF-006 benchmark evidence

- Workload: 60 validated projects, 2,000 3D point features per project, 18.1 MiB
  total GeoJSON, five samples, fake IndexedDB, React hook publication, and
  explicit garbage collection for mounted-heap comparison.
- Current implementation preliminary result: first publication median 144.6 ms;
  all-project cold median 195.9 ms (worst 260.8 ms); warm-revision median 50.9
  ms (worst 51.0 ms); mounted heap delta median 53.1 MiB. These numbers are not
  an improvement claim until the identical `1a8e3ef` baseline completes.
- Identical final comparison after adding the full-path workload:
  - First publication median: baseline 374.5 ms; current 139.5 ms.
  - All-project cold median: baseline 634.2 ms; current 193.9 ms.
  - Warm-revision median: baseline 749.0 ms; current 50.9 ms.
  - Mounted heap delta median: baseline 173.0 MiB; current 59.7 MiB.
  - Full post-network median: baseline 250.5 ms; current 164.5 ms.
  - Maximum timer-delay median: baseline 23.4 ms; current 7.4 ms.
- The deterministic desktop workload therefore does not reproduce the physical
  phone regression. Worker structured cloning/startup, real WebKit IndexedDB,
  and MapLibre commit-to-paint remain unmeasured and require native-safe timing
  at their production boundaries before another behavior change.

### PERF-006 diagnostic TDD evidence

- Red command:
  `npx vitest run src/utils/performanceTiming.test.ts src/pages/dashboard/useDashboardMapData.test.ts src/controllers/SpeleoDBController.test.ts -t 'forwards aggregate|logs aggregate GeoJSON|logs cache, normalization'`.
- Red result: no aggregate GeoJSON records existed and no Dashboard-to-paint
  records existed. The two production-boundary assertions failed as expected;
  the fixed-field forwarding test established the new safe schema expectation.
- Green selected result: 3/3 pass, followed by 331/331 owning web tests.
- Android `./gradlew testDebugUnitTest` — pass, including the native formatter
  allowlist and a production web-asset build.
- iOS focused XCTest — 4/4 formatter tests pass on an iPhone 17 Pro / iOS 26.5
  simulator. A fresh `ios/DerivedData/PerfDiagnostics` path avoided the stale
  cross-module Swift `.priors` cache failure.
- Production diagnostics now emit constant-memory aggregate work totals for
  cache reads, download/JSON decoding, normalization, worker validation and
  structured clone, durable writes, and Dashboard completion-to-next-paint.
  Native formatters accept only the new fixed scopes/phases; identifiers,
  credentials, URLs, coordinates, and payloads remain impossible to forward.
- Full web gate: lint, typecheck, and production build pass (616 modules); 117
  test files pass with 2 skipped, 1,923 tests pass with 13 skipped. Coverage is
  90.43% statements, 82.02% branches, 92.91% functions, and 92.55% lines.
- Quality inventory passes after classifying the standalone benchmark tooling;
  no generated Android or iOS web-asset diff remains tracked.
