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
   reconciliation per project. Visibility is prompt, but 60 separate updates
   are unnecessary when several records become ready in the same rendering
   turn.
5. Overlay synchronization and GPS metadata synchronization are independent
   after project GeoJSON is durable, but the foreground path awaits them
   serially. Landmark collections also wait for all overlay writes despite
   having an independent endpoint and cache key.

A project-ID `Map` would reduce an O(projects²) lookup bounded at roughly 3,600
comparisons for 60 projects. That cost is negligible beside repeated IndexedDB
transactions, structured clones, full feature scans, React renders, and
MapLibre source updates, so it is not the first optimization target.

## Delivery units

### PERF-003 — Deduplicate validated project-record reads

- [x] Add fake-IndexedDB/service tests proving concurrent consumers share one
  authoritative record read and later readers reuse the immutable result.
- [x] Prove durable validated/quarantined/legacy writes replace the read-through
  entry only after commit, failed writes preserve the prior entry, and logout
  clears memory immediately.
- [x] Execute the focused tests and record the expected failures.
- [x] Add a bounded read-through/single-flight record cache inside
  `ProjectCacheService`; preserve per-caller cancellation checks without binding
  a shared IndexedDB read to the first caller's signal.
- [x] Reuse derived depth-enriched FeatureCollections by immutable source
  identity so revision-only reloads do not rescan coordinates.
- [x] Add a 60-project regression proving reconciliation plus subsequent map
  reads require one durable record read per project, not two or three.
- [x] Update cache, sync, map-data, and performance documentation.
- [x] Run focused and complete verification.
- [x] Commit as `[Fix] Deduplicate project cache reads`; inspect the commit and
  clean status before PERF-004. Do not push.

### PERF-004 — Batch ready map-data publication

- [ ] Add a hook regression proving independently ready records coalesce into
  one publication turn while a slow record cannot block the first batch.
- [ ] Execute and record the expected failure.
- [ ] Coalesce ready project and overlay records per cooperative rendering turn
  without delaying the first available data or weakening stale-generation
  checks.
- [ ] Preserve per-project commit gating and failure isolation.
- [ ] Measure render/publication count with 60 immediate records.
- [ ] Update Dashboard map-data performance documentation and verification.
- [ ] Commit as `[Fix] Batch dashboard map publication`; inspect the commit and
  clean status before PERF-005. Do not push.

### PERF-005 — Parallelize independent foreground metadata sync

- [ ] Add a coordinator regression proving overlay and GPS phases start
  together after durable project GeoJSON publication and the foreground result
  waits for both.
- [ ] Add an overlay regression proving landmark collections do not wait for
  unrelated overlay cache writes.
- [ ] Execute and record the expected failures.
- [ ] Run overlay and GPS synchronization concurrently with independent timing
  records, cancellation, durable publication, and partial-failure behavior.
- [ ] Fetch/persist landmark collections concurrently with overlay work.
- [ ] Update phase-order and timing documentation.
- [ ] Run focused and complete verification.
- [ ] Commit as `[Fix] Parallelize sync metadata persistence`; inspect the
  commit and clean status. Do not push.

## Deferred architecture review

After PERF-003 through PERF-005, use physical-device timings to decide whether
60 per-project MapLibre sources remain material. A combined project source
could reduce source/layer count substantially, but it changes visibility,
color, depth, hit-testing, and source-ownership contracts. It must not be
undertaken without post-fix evidence showing MapLibre reconciliation—not
storage—is still dominant.

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

- Red command: `npx vitest run src/services/ProjectCacheService.test.ts
  src/pages/dashboard/useDashboardMapData.test.ts -t
  'single-flights and reuses validated project records|keeps cancellation
  caller-scoped|reduces two 60-project consumer passes|publishes a durable
  replacement|updates legacy and quarantine cache entries|reuses
  depth-enriched project data'`.
- Red result: same-project consumers performed 4 backing reads instead of 1;
  two concurrent and one later pass over 60 projects performed 180 reads
  instead of 60; durable replacement readers returned the old backing value;
  and a revision-only reload created a second depth-enriched collection.
- Green focused result: 8/8 pass, including old-read/new-write ordering and
  pre-clear in-flight logout invalidation.
- Green owning suites: `ProjectCacheService.test.ts`,
  `useDashboardMapData.test.ts`, and `SpeleoDBController.test.ts` — 256/256
  pass before the final repository gate.

### PERF-003 implementation result

- `ProjectGeoJSONRecordMemoryCache` owns a 64-entry LRU, concurrent
  single-flight reads, per-project write versions, and a logout generation.
- The first consumer performs the unavoidable IndexedDB read and structured
  clone; reconciliation and later Dashboard generations reuse its immutable
  record. The 60-project regression reduces deterministic backing reads from
  180 to 60.
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
  1,916 tests passed, 13 skipped. Coverage: 90.41% statements, 82.16%
  branches, 92.83% functions, 92.50% lines.
- `npm run quality:inventory` — pass; all 599 files classified.
- Button background hard-rule scan — no matches.
- MapLibre declarations were not changed; source-ownership coverage remains
  green in the complete suite.
- `git diff --check` — pass.
- No native source or generated native asset changed, so native compilation is
  inapplicable to this TypeScript/cache delivery. Physical-device timings after
  installation remain the authoritative performance measurement.
