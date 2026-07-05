# Tile Cache Performance, Freshness, and Offline Coverage

## Goal

Make cached raster tiles render without waiting on network state, repair the
durable meaning of offline coverage, refresh tiles on a 180-day rolling policy,
and extend zoom-18 offline coverage to projects, landmarks, stations, and local
and server GPS tracks.

## Implementation gates

- [x] Make the MapLibre protocol cache-first: fresh hits never fetch; stale hits
      render immediately and revalidate in the background.
- [x] Add bounded tile transport deadlines, retry classification, cancellation
      rechecks, no-data suppression, and background refresh deduplication.
- [x] Upgrade `speleo_tiles` to v6 with fetch timestamps, typed prefetch jobs,
      reference-counted tile ownership, LRU indexing, and repaired statistics.
- [x] Make tile replacement, capacity eviction, metadata, ownership, and stats
      atomic; approved overflow must apply only to offline-owned tiles.
- [x] Remove startup-wide pinned writes, coalesce LRU touches, and make Settings
      cache statistics constant-time.
- [x] Replace project-specific prefetch identity with typed targets and prove
      migrated/legacy completed jobs cannot claim missing or evictable coverage.
- [x] Add zoom-18 planning for projects, landmarks, surface/subsurface stations,
      and local/server GPS tracks, with path-aware GPS coverage and URL dedupe.
- [x] Move expensive plan enumeration behind the worker boundary and keep
      download/job publication bounded so the WebView remains responsive.
- [x] Reconcile obsolete target ownership without deleting shared tiles.
- [x] Add the rolling **Refresh offline maps** controller/UI flow for forced and
      opted-in layers, retaining old payloads until replacements commit.
- [x] Report completed coverage rather than processed attempts; failed tiles
      must never render as 100% or `Map ready`.
- [x] Disable raster fade and automatic initial-fit animation while preserving
      user-triggered map animations.
- [x] Update tile/offline/map/settings/GPS documentation and capture the
      reusable cache-hit latency lesson.

## Verification gates

- [x] Authoritative MapLibre protocol tests cover fresh, stale, missing,
      offline, invalid, cancelled, deduplicated, and durable replacement paths.
- [x] Real fake-IndexedDB tests cover v4/v5-to-v6 migration, ownership,
      promotion, release, shared tiles, capacity concurrency, statistics, and
      recovery.
- [x] Prefetch tests cover typed targets, freshness, forced refresh, retry
      classification, queue progress, cancellation, and ownership
      reconciliation.
- [x] Planner/worker tests cover projects, point overlays, GPS paths, dateline
      handling, batching, dedupe, and cancellation.
- [x] Controller/component tests cover all target sources, the Settings refresh
      confirmation/gates, truthful percentages, and logout cancellation.
- [x] Focused suites pass.
- [x] `make ci` passes.
- [x] Capacitor Android/iOS sync output is inspected and native compile/tests
      pass.
- [ ] Physical Android and iOS slow-network/offline evidence is recorded, or the
      missing device evidence is explicitly listed as a release limitation.

## Review

### Result

- Runtime tile reads are cache-first with a deterministic 180-day `fetchedAt`
  TTL, immediate stale rendering, deduplicated rolling refresh, and a hard
  10-second deadline even when the underlying transport ignores abort.
- IndexedDB v6 owns reference-counted target coverage and commits capacity,
  eviction, payload, metadata, ownership, and aggregate statistics atomically.
- Legacy payloads with no trustworthy fetch timestamp are assigned the migration
  time and remain fresh for 180 days. The v6 corrective migration also repairs
  zero timestamps written by the initial v5 implementation without deleting
  payloads.
- Satellite/enabled layers cover projects, landmarks, combined stations, and
  durable local/SHA-identified server GPS paths through zoom 18.
- Settings provides confirmed forced refresh and truthful completed coverage;
  rendering removes raster fade and the automatic initial-fit animation.
- Design and performance ownership are documented in
  `docs/tile-cache-architecture.md`; the reusable regression rule is in
  `tasks/lessons/online-cache-hits.md`.

### Verification evidence

- Baseline before implementation: focused tile/controller/Settings run, 7 files
  / 296 tests passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- Focused repository/prefetch/planner/worker/coordinator gate: 5 files / 79
  tests passed. The authoritative controller/coordinator gate passed 2 files /
  188 tests.
- `make ci`: passed after the follow-up; 105 files / 1,791 tests, 89.23%
  statements, 81.41% branches, 92.33% functions, 91.51% lines; production Vite
  build passed.
- `npx cap sync`: passed for Android and iOS; inspection found zero tracked
  native diffs.
- `./gradlew testDebugUnitTest assembleDebug`: passed (492 tasks; debug APK and
  Android unit-test targets).
- Unsigned generic iOS Simulator build with `xcodebuild`: passed.
- Signed iPhone 17 Simulator `xcodebuild ... test`: passed all
  `AppBridgeViewControllerTests`, `SensitiveDataProtectionTests`, and
  `KeychainCredentialStoreTests`.
- `git diff --check`: passed; the `.app-btn` opacity-background hard-rule scan
  returned zero matches.

### Limitations and release evidence still required

- No physical Android or iOS device was attached. Slow-network conditioning,
  airplane mode, warm restart, force-quit persistence, interrupted refresh,
  layer switching, and the <=50 ms warm-tile / <=300 ms cached-viewport p95
  targets still require the release device matrix. This is the only unchecked
  verification gate above.
- No commit was created or requested; commit references: none.

### Follow-up correction

- Replaced the long inline Settings control with a compact, solid, full-width
  action under Map Layers.
- Corrected legacy freshness migration from forced-stale to migration-time fresh
  and added a v5-to-v6 recovery test for caches already affected.
- Focused repository/protocol/Settings correction gate: 4 files / 92 tests;
  lint, type checking, and diff checks passed.
- Captured the migration rule in `tasks/lessons/cache-migration-freshness.md`.
- Stabilized the coverage denominator as tiles-per-layer × enabled layers so
  streamed planning cannot make the displayed total jitter.
- Replaced the 256-URL audit head-of-line stall with 16-URL handoff batches and
  progress publication at most every 100 ms, without increasing durable
  job-write frequency or starting the writer inside the audit transaction loop.
- Added a real fake-IndexedDB prefetch integration test proving a multi-batch
  plan drains completely through ownership and payload transactions.
- Made displayed usable coverage monotonic for an unchanged enabled-layer scope
  and froze the reference denominator while replacement generations plan.

### Adversarial correction (2026-07-01)

The earlier "bounded" statement applied only to worker placement, not to raw
coordinate retention, the ready queue, delayed retries, or lifetime URL state.
The corrected v8 design bounds worker handoff/staging pages at 2,048, audits at
16, uses six workers, and limits outstanding coordinate work to 64. It also
removes the retired target-owner production APIs; v6 owner records now exist
only as private migration input.

The original 10-second transport deadline stopped at headers and the global hash
list incorrectly applied a satellite fingerprint to hillshade. The corrected
deadline includes body/content validation and hashing, and hashes are owned by
each layer. Cache clear/logout now aborts refreshes with an epoch guard.
Previous automated/native command results remain historical; the corrected
tree's exact results and unproven physical-device p95/slow-network matrix are in
the adversarial review task.
