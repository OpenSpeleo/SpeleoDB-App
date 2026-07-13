# Offline-Map In-Memory Plan Deduplication

## Goal

Remove the per-coordinate IndexedDB staging round trip from offline-map plan
construction. Deduplicate and sort packed coordinates in the planner worker,
enforce a hard ceiling of 1,000,000 unique tiles, and persist only final compact
plan chunks.

## TDD and implementation gates

- [x] Add planner tests proving duplicate coordinates produce one sorted output
      coordinate and the reported count is the unique count.
- [x] Add a planner test proving the 1,000,001st unique coordinate fails with an
      explicit limit error before any final plan is published.
- [x] Add an engine seam test proving final worker chunks are written directly
      and no temporary coordinate staging operation is admitted.
- [x] Run the focused tests and record the expected pre-fix failures.
- [x] Implement safe-integer coordinate packing, worker-local `Set<number>`
      deduplication, in-place typed-array sorting, and transferred final chunks.
- [x] Replace engine staging/count/read/delete with direct final-chunk writes
      and commit the manifest only after all chunks are durable.
- [x] Preserve cancellation, worker acknowledgement/backpressure, immutable-plan
      winner selection, and cleanup of incomplete chunks.
- [x] Update architecture and performance documentation, including the 1M limit
      and transient-memory implications.
- [x] Run focused tests, lint, typecheck, build, the complete CI test suite,
      coding-rule checks, and `git diff --check`.
- [x] Inspect staged and unstaged diffs, commit this objective independently,
      verify the commit, and confirm no unintended worktree changes.

## Review

### Root cause and correction

The physical-device `plan_schedule` timing was 48,320 ms for approximately
12,000 unique coordinates. Network work was already complete. The planner sent
raw coordinates to the WebView in 2,048-coordinate batches, and the WebView
performed an IndexedDB `put` for every coordinate. It then counted the unique
rows, read them back through cursors, rewrote compact plan chunks, and deleted
the temporary rows in 250-record transactions. IndexedDB was therefore acting as
an expensive temporary hash table.

The dedicated worker now packs `{z,x,y}` into one safe integer, deduplicates in
a `Set<number>`, rejects the 1,000,001st unique key, copies the settled keys
into a sorted `Float64Array`, and transfers final `Uint32Array` chunks. The
engine writes each final chunk before acknowledging the worker and publishes the
manifest last. A 12,000-coordinate plan is six chunk transactions instead of
12,000 object-store writes plus count/read/delete passes. Legacy v8 staging is
retained only for upgrade/crash cleanup compatibility.

### TDD evidence

- Red command:
  `npx vitest run src/services/OfflineMapPlanner.test.ts src/services/OfflineMapSyncEngine.test.ts`.
- Red result: 3 failures. The planner reported 3,000 raw coordinates for 3,000
  identical points instead of one unique coordinate; the 1M constant/guard was
  absent; and the engine did not make a final chunk durable during the planner
  acknowledgement cycle.
- Green focused command:
  `npx vitest run src/services/OfflineMapPlanner.test.ts src/services/OfflineMapSyncEngine.test.ts src/services/OfflineMapSyncEngine.repository.test.ts`.
- Green focused result: 3 files / 27 tests passed. This includes the literal
  1,000,001st-coordinate rejection and a 12,000-coordinate engine seam proving
  exactly six final chunk writes.

### Performance evidence

A temporary, uncommitted ten-sample benchmark exercised production packed
deduplication/sorting and production compact plan-chunk persistence for 12,000
unique coordinates under fake IndexedDB. Median total was 1.15 ms and worst was
8.08 ms; the cold first sample was the worst. The benchmark file was removed
after recording the results so timing assertions cannot make CI flaky.

This desktop benchmark proves algorithm shape and operation count, not iPhone
wall-clock performance. The existing 48,320 ms physical result is the baseline;
a new physical-device `plan_schedule` sample from the committed build remains
the authoritative candidate measurement.

### Verification

- `npm run lint` and `npm run typecheck` passed.
- `npm run build` passed and emitted the revised planner worker bundle.
- The first `API_TEST_ENABLED=false npm run test:ci` passed 117 files / 1,925
  tests with 2 configured files and 13 staging-only tests skipped. Coverage was
  90.42% statements, 82.02% branches, 92.95% functions, and 92.52% lines. The
  final rerun after adding the literal 1,000,001-coordinate boundary executed
  all 1,925 product tests successfully but was non-green because the PWA
  metadata test's in-process Vite build emitted Rolldown's known
  nondeterministic `PLUGIN_TIMINGS` console warning. The separate test-harness
  correction then restored the final full gate: 117 passed files / 1,925 passed
  tests with the same 2 configured files and 13 staging-only tests skipped and
  the same coverage values.
- `npm run quality:inventory` covered all 607 tracked files.
- `npx cap sync` passed for Android and iOS with no tracked native diff.
- Android `./gradlew testDebugUnitTest lintDebug assembleDebug` passed.
- iOS generic-simulator Debug `xcodebuild` passed with signing disabled and a
  fresh task-specific DerivedData directory. This avoided the unrelated stale
  SwiftDriver `.priors` cache failure reported from the shared DerivedData path.
- `git diff --check` and the hard button-background scan passed. No TSX or
  MapLibre source structure changed, so the MapLibre source-injection gate was
  inapplicable. An attempted `npm run test:maplibre-contract` was rejected
  because no such package script exists and is not counted as evidence.

### Limitations

No physical device was attached to this execution environment. Web, Android, iOS
compilation, storage integration, worker protocol, exact limit, and
operation-count behavior are proven; the post-fix physical-device wall clock and
UI responsiveness still require the existing diagnostic log from an installed
candidate build. No artifact was pushed or published.

Planner fix commit: `1474cfd4a367eb0a6334fc1a60b1c5a6727451ef`.
