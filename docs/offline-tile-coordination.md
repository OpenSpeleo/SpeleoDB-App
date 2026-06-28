# Offline mutation and tile coordination

## Intent

Offline mutation replay and tile prefetch are durable, cancellation-sensitive
subsystems. Their lifecycle must not depend on controller field ordering, and
logout must tear both down before persistent data is cleared.

`SpeleoDBController` remains the public façade. Ownership is split as follows:

- `OfflineMutationCoordinator` owns queue construction/reset, restored-state
  publication, pending count/revision, optimistic folds, enqueue delegation,
  replay, discard, and conflict resolution.
- `OfflineOpQueue` remains the persistence/coalescing/idempotent replay engine;
  its serialized operation format is unchanged.
- `TileCoordinator` owns prefetch service lifecycle, job state, storage consent,
  per-layer settings, satellite-first scheduling, project/landmark input
  preparation, target removal, cancellation, and logout cleanup.

The controller supplies the narrow `OfflineReplayPort` because confirmed replay
results update landmark/GPS ground-truth caches owned by their domain seams.

## Offline mutation invariants

- Restored operations publish one revision only when persisted work exists.
- Every queue mutation increments the coordinator revision before notifying UI.
- Ground truth changes only after confirmed server success; offline reads fold
  pending intent over that ground truth.
- Queue reset on logout replaces in-memory operations without changing the
  persisted wire format; `ProjectCacheService.clearAll()` removes the store.
- Replay and conflict APIs never bypass `OfflineOpQueue` ordering or
  idempotency rules.

## Tile invariants

- Full sync schedules the forced satellite layer first, then opted-in layers.
- GeoJSON quarantine calls `TileCoordinator.removeTarget` across every layer.
- Manual layer enable uses its own cancellation context; logout cancels all
  outstanding manual-layer work.
- Storage approval and acknowledgement are non-secret preferences. Runtime cap
  state is updated at the same transition and stalled jobs resume only after
  approval.
- Logout unsubscribes and disposes the service, waits for worker idleness,
  clears tile/job persistence concurrently with the main cache, then creates a
  fresh runtime.

## Verification and performance

The controller characterization suite covers queue restoration, optimistic
folds, enqueue failure, replay/conflicts, layer toggles, satellite-first order,
storage consent, stalled diagnostics, cancellation, and logout teardown through
the public façade. `OfflineOpQueue`, tile planner, prefetch service, and tile
repository retain focused unit and race tests.

No new polling, retries, persistence records, or tile scans are introduced.
Project GeoJSON is read once per full sync and reused across enabled layers;
tile cleanup remains concurrent with the main cache purge.
