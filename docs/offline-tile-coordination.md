# Offline mutation and offline-map coordination

## Intent

Offline mutation replay and offline-map synchronization are durable,
cancellation-sensitive subsystems. Their lifecycle must not depend on controller
field ordering, and logout must tear both down before persistent data is
cleared.

`SpeleoDBController` remains the public façade. Ownership is split as follows:

- `OfflineMutationCoordinator` owns queue construction/reset, restored-state
  publication, pending count/revision, optimistic folds, enqueue delegation,
  replay, discard, and conflict resolution.
- `OfflineOpQueue` remains the persistence/coalescing/idempotent replay engine;
  its serialized operation format is unchanged.
- `TileCoordinator` owns engine lifecycle, source collection, storage consent,
  per-layer settings, cancellation, and logout cleanup.
- `DownloadAreaService` owns the persisted manual/automatic catalog, shared
  union plan, serial layer queue, foreground lifecycle, and per-area progress.
  See `offline-download-areas.md`.
- `OfflineMapSyncEngine` owns immutable plans, coverage/layer generations, the
  six-worker queue, retries, checkpoints, and the dedicated progress store.

The controller supplies the narrow `OfflineReplayPort` because confirmed replay
results update landmark/GPS ground-truth caches owned by their domain seams.

## Offline mutation invariants

- Restored operations publish one revision only when persisted work exists.
- Every queue mutation increments the coordinator revision before notifying UI.
- Ground truth changes only after confirmed server success; offline reads fold
  pending intent over that ground truth.
- Queue reset on logout replaces in-memory operations without changing the
  persisted wire format; `ProjectCacheService.clearAll()` removes the store.
- Replay and conflict APIs never bypass `OfflineOpQueue` ordering or idempotency
  rules.

## Tile invariants

- Full sync schedules the forced satellite layer first, then opted-in layers.
- Matching current quarantines are intentional empty inputs. Every other
  required project, overlay, or current-SHA GPS input must resolve; a transient
  omission fails planning and leaves all prior active coverage intact.
- Source collection owns a monotonic version and cancellation context. Layer
  switches do not supersede source reads; the catalog transaction uses the
  latest shared preference when it commits geometry. A late preference failure
  cannot roll back a newer switch.
- Every area contributes its rectangle to one deduplicated coordinate plan.
  Layer switches reuse it and only add/remove that provider’s work and claims.
  Manual, project, landmark and GPS areas use the same enabled layers. Cached
  payloads survive disabled ownership without prefix eviction.
- Pending landmark mutations are folded before rectangle conversion. Landmark
  changes schedule preparation; hidden source objects remain eligible.
- Completed standalone GPS uploads, deletions and list refreshes schedule the
  same source reconciliation after the complete operation and cancellation
  check. Full sync schedules after all source caches are ready. Intermediate
  upload state and individual recording fixes do not schedule additional
  preparation.
- Storage approval and acknowledgement are non-secret preferences. Runtime cap
  state is updated at the same transition and the paused queue resumes only
  after approval.
- Logout disposes the engine, waits for worker idleness, clears tile/plan/
  generation persistence concurrently with the main cache, then creates a fresh
  runtime.
- Tile progress publishes through `subscribeOfflineMapSync`, never the global
  controller observer. Durable checkpoints cannot delay live UI counters.

## Verification and performance

The controller characterization suite covers queue restoration, optimistic
folds, enqueue failure, replay/conflicts, layer toggles, satellite-first order,
storage consent, stalled diagnostics, cancellation, and logout teardown through
the public façade. `OfflineOpQueue`, canonical planner, sync engine/store, and
tile repository retain focused unit and race tests.

Settings performs no polling. Project GeoJSON is read once per full sync and all
areas contribute to one union plan reused across enabled layers. Source planning
may re-read a required record after validation to prove current-commit
completeness. Tile cleanup remains concurrent with the main cache purge.
