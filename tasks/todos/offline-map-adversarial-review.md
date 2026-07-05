# Offline-Map Adversarial Review and Correction

## Goal

Audit and correct the staged offline-map synchronization rewrite without
discarding or unstaging user work. Preserve cached payloads and active coverage
while proving planning, migration, cancellation, concurrency, progress, and
runtime cache invariants at their authoritative production seams.

## Review gates

- [x] Review every staged and unstaged path against HEAD and the final worktree.
- [x] Record the authoritative invariant, owner, callers, failure modes, and
      evidence for planner, downloader, repository, runtime, coordination, and
      UI.
- [x] Compare the removed scheduler with HEAD and
      `d556d2356915bb510a1fc0764a6d020d1718279d`.
- [x] Preserve the staged index and keep corrective edits unstaged.

## Implementation gates

- [x] Fail closed when any required project, overlay, or current-SHA GPS source
      is unavailable; never activate a partial replacement.
- [x] Stream and deduplicate canonical coordinates through bounded v8 staging,
      then commit immutable compact plan chunks and garbage-collect stale plans.
- [x] Bound audit, ready, active, and delayed-retry work while retaining six
      workers, satellite priority, URL uniqueness, and retry classification.
- [x] Apply one deadline through response body validation and hashing; scope
      no-data fingerprints per layer and reject unverifiable/invalid rasters.
- [x] Make tile/tombstone transactions abortable through commit and prevent
      stale runtime refreshes from writing after cache clear or logout.
- [x] Recover interrupted generations, persist counter normalization, release
      every previous active generation, and preserve transactional statistics.
- [x] Linearize coverage requests and make layer disable release-before-evict,
      reuse the active plan, and preserve remaining enabled-layer work.
- [x] Make progress publication scheduler-safe, observer-safe, bounded, and
      failure-aware without app-wide per-tile context updates or polling.
- [x] Remove obsolete compatibility APIs and align all impacted documentation,
      task reviews, and durable lessons with production behavior.

## Verification gates

- [x] Add authoritative hostile regression tests for storage, transport,
      cancellation, restart, supersession, planner bounds, progress, and UX.
- [x] Record deterministic concurrency, dispatch-gap, fast-path, publication,
      and bounded-memory measurements without presenting them as device p95.
- [x] Run focused offline-map suites.
- [x] Run lint, typecheck, production build, and complete `make ci`.
- [x] Run hard button/source contract scans and both staged/unstaged diff
      checks.
- [x] Run Capacitor sync, inspect native diffs, and run applicable Android/iOS
      builds and tests.
- [x] Record missing physical-device evidence as release limitations.

## Review

### Severity-ordered findings and corrections

1. **Critical — incomplete source reads could activate reduced coverage.**
   Project/overlay/GPS loaders converted missing/transient inputs to omissions,
   so a successful smaller generation could release valid active tiles. Source
   collection now distinguishes resolved empty/quarantined inputs from failures,
   requires current project commits and current server GPS SHA geometry, and
   aborts before engine scheduling. A monotonic request version prevents an old
   uncancellable read from winning later. Coordinator and GPS regressions prove
   active scheduling is not reached on incomplete input and legacy GPS remains
   displayable.
2. **High — planning and dispatch retained work proportional to the plan.** The
   worker built a lifetime set/sort and the engine accumulated ready URLs and a
   lifetime seen set. Raw enumeration now uses 2,048-coordinate acknowledged
   chunks, v8 compound keys own dedupe, sorted typed chunks are compacted in
   bounded transactions, and the manifest commits last. Audit batches are 16,
   workers are six, and total outstanding work is capped at 64 (which also
   bounds ready and delayed-retry work). Startup removes crashed
   staging/chunk-only builds; structural corruption rebuilds; old plans/chunks
   are collected in bounded batches after a grace period.
3. **High — cancellation did not own persistence or session lifetime.** Abort
   could arrive during an IndexedDB write, and stale background refresh could
   write after clear/logout. A cancellation arriving while the final generation
   checkpoint was blocked could also pass the earlier abort check and activate
   afterward. Payload and tombstone transactions now attach abort directly,
   recheck generation/signal before final metadata/statistics, and are tested
   with real fake-IndexedDB transaction aborts. The engine rechecks session
   ownership after its awaited final checkpoint, and a regression proves a late
   checkpoint cannot overtake terminal cancellation. Runtime refresh owns an
   abort controller plus cache epoch, so late ignored transport settlement
   cannot cross logout/clear.
4. **High — layer disable/supersession was not atomic.** New requests now
   invalidate older source ownership. Enable uses a discriminated active-plan
   reuse request and falls back only for `OfflineMapPlanUnavailableError`.
   Disable cancels the session, releases successfully before prefix eviction,
   updates statistics, resumes remaining layers from the active plan, and rolls
   preferences back on failure. Activation returns every prior active
   generation.
5. **High — tile validation and no-data provenance were too weak.** One
   10-second deadline now covers headers, accepted raster content type,
   non-empty body, hashing, and cancellation. Validation returns explicit
   raster/no-data outcomes; HTTP/invalid responses never create tombstones.
   Hashes live on `MapLayerDefinition`: the known fingerprint is satellite-only;
   both hillshade lists remain empty. Configured hashing fails closed when
   unavailable.
6. **Medium — progress could freeze, lie, or be broken by observers.** The store
   now handles synchronous/frozen RAF, cancellation/disposal, listener mutation,
   and throwing observers. Audited/queued counters are normalized; corrupt
   durable counters are repaired on preload; terminal failures are visible
   overall and by layer; migration shows “Preparing…”. The dedicated
   `useSyncExternalStore` seam still isolates unrelated context consumers.
7. **Medium — historical evidence overstated the implementation.** Architecture,
   layer/offline/Settings/GPS/coordination/logout docs and all five existing
   task reviews now identify v8 staging, source completeness, actual hash
   provenance, deterministic-vs-device evidence, and remaining release blockers.

### Migration and compatibility assessment

The upgrade is additive: database version 8 creates only temporary coordinate
staging and missing indexes. Existing URL payloads, metadata, v7 manifests,
generations, and memberships are neither rewritten nor deleted. The resumable v6
ownership migration remains private, uses 250-record transactions, preserves
valid freshness, and is completed before active coverage publication. Preload
also removes crash staging, reclaims pending/failed/releasing generations, and
persists only corrupt counter normalization.

A binary rollback from a database already opened at v8 to an older application
that explicitly opens v7 would receive IndexedDB `VersionError`; payloads are
preserved, but the old binary is not schema-forward-compatible. Release/rollback
planning must account for that standard IndexedDB downgrade limitation.

### Deterministic measurements

- Controlled 100 ms transport: six concurrent workers complete 1,000 tiles in
  16.7 simulated seconds versus a 100-second serial lower bound (5.99×), with
  measured dispatch gaps no greater than 100 ms.
- Queue high-water regression reaches exactly 64 outstanding coordinates and
  returns to zero on cancellation; planner/storage chunks never exceed 2,048 raw
  coordinates and cache audits never exceed 16.
- Fresh unchanged coverage performs one manifest lookup and zero cache audits,
  generation writes, or network calls.
- Frozen RAF publishes at the 50 ms fallback; synchronous RAF can publish
  repeatedly without retaining a stale scheduled handle.

These are deterministic tests, not Android/iOS WebView p95 measurements.

### Command log

- Focused changed-seam gate: 18 files / 483 tests passed.
- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm run build` — passed; worker chunk 5.78 kB and lazy sync engine 15.44 kB
  in this build (uncompressed output sizes).
- `make ci` — sandboxed attempt failed only because live integration DNS for
  `stage.speleodb.org` was blocked; final network-enabled rerun passed 106 files
  / 1,819 tests. Coverage: 89.63% statements, 81.89% branches, 92.61% functions,
  91.56% lines. Its production build passed.
- `rg 'app-btn[^"\n]*bg-' src --glob '*.tsx'` — zero matches.
- `npm run test.unit -- --run src/pages/dashboard/DashboardMapLayers.test.tsx` —
  1 file / 6 source-injection contract tests passed.
- `git diff --check` — passed for unstaged corrections.
- `git diff --cached --check` — still fails on the preserved baseline
  `tasks/lessons/online-cache-hits.md:12` blank EOF line. The worktree removes
  it, but changing the index would violate the explicit preserve-index rule.
- `npx cap sync` — passed; Android/iOS tracked diff remained empty.
- Android `./gradlew testDebugUnitTest assembleDebug` — passed, 492 tasks.
- Unsigned generic iOS device `xcodebuild ... build` — passed.
- Signed iPhone 17 Pro / iOS 26.5 simulator `xcodebuild ... test` — passed all 9
  `AppTests`.

### Physical-device gaps and requirements still unproven

ADB reported no attached Android device. Xcode reported the physical iOS device
`Pandalicious` offline. Therefore the following remain release blockers:

- physical Android/iOS warm-tile, cached-viewport, unchanged-plan startup, and
  progress-publication p95 measurements;
- slow-network, airplane-mode, restart/force-quit, interruption, storage-full/
  consent, rapid layer switching/disable, and zero-network cached viewport runs;
- on-device WebView SHA-256 availability and low-coverage hillshade appearance;
- upgrade of an actual field v6/v7 database under device storage pressure.

Simulator, fake-time, and fake-IndexedDB evidence is not substituted for those
requirements.

### Worktree inventory

- Base remains `2502cb30972d81d7819b5e3014f6498e69ceb7e6`.
- Staged index remains exactly 66 paths, 6,602 insertions / 3,917 deletions.
- Corrective unstaged tracked work: 55 paths, 2,429 insertions / 1,014
  deletions.
- Untracked corrective files: `tasks/todos/offline-map-adversarial-review.md`
  and `tasks/lessons/rolling-replacement-input-completeness.md`, plus the
  follow-up `tasks/todos/offline-map-planner-worker-stall.md` review.
- Android/iOS tracked diffs: none. No files were staged, unstaged, reset, or
  committed by this correction; commit references: none.

### Post-review correction — production planner protocol

Device testing exposed that the production planner remained in `planning` even
though fallback-based unit tests passed. The caller posted `{id,input}`, while
the worker accepts only the discriminated `{id,type:'plan',input}` request. The
worker correctly ignored the malformed message, so neither a chunk, completion,
nor error returned and project sync remained waiting. The caller now includes
the `plan` discriminant, and a production-branch protocol regression proves the
`plan -> chunk -> ack -> done` exchange. Full CI subsequently passed 106 files /
1,820 tests; the production bundle was inspected for the corrected message and
synced into Android/iOS with no tracked native drift.
