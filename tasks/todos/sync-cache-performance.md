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

- [ ] Add fake-IndexedDB/service tests proving concurrent consumers share one
  authoritative record read and later readers reuse the immutable result.
- [ ] Prove durable validated/quarantined/legacy writes replace the read-through
  entry only after commit, failed writes preserve the prior entry, and logout
  clears memory immediately.
- [ ] Execute the focused tests and record the expected failures.
- [ ] Add a bounded read-through/single-flight record cache inside
  `ProjectCacheService`; preserve per-caller cancellation checks without binding
  a shared IndexedDB read to the first caller's signal.
- [ ] Reuse derived depth-enriched FeatureCollections by immutable source
  identity so revision-only reloads do not rescan coordinates.
- [ ] Add a 60-project regression proving reconciliation plus subsequent map
  reads require one durable record read per project, not two or three.
- [ ] Update cache, sync, map-data, and performance documentation.
- [ ] Run focused and complete verification.
- [ ] Commit as `[Fix] Deduplicate project cache reads`; inspect the commit and
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

Pending implementation evidence.
