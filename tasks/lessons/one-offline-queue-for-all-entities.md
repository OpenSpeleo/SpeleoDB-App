# One offline queue for ALL entity mutations

## The directive (from the user, GPS tracks feature)

> "I want everything to follow the same approach as Landmarks. Everything should
> be represented as an offline op and goes to the same queue of ops. And be
> shown to the Pending page. It's a design pattern of the app, document it so
> that you never have a doubt or do something different."

## The rule

Any offline-capable create / edit / delete — for **any** entity — MUST be an
`OfflineOp` in the single shared `OfflineOpQueue`, surfaced on the **Pending**
page. Do **not** invent a parallel offline mechanism (no per-entity
`status`/`pending` fields with bespoke "drain on reconnect" loops).

To add a new entity:

1. Add it to `OfflineEntityType` (`src/types/offlineOp.ts`).
2. Subclass `OfflineOp` (create/update/delete) with a pure `applyTo*` fold + a
   snapshot helper for conflict detection (mirror `landmarkSnapshot.ts`).
3. Extend `OfflineReplayPort` with the entity's HTTP + ground-truth-apply
   methods and wire them in `SpeleoDBController.buildOfflineQueue()`.
4. Route the controller mutation through the queue (online-attempt → enqueue on
   unreachable → throw on definitive 4xx), exactly like `createLandmark`.
5. Read the optimistic view via a fold over the cached ground truth.

You then inherit persistence, ordering, coalescing, conflict resolution, the
Pending page, and the `pendingOpsCount` badge for free.

## What this replaced (anti-pattern to avoid)

GPS track uploads used to carry an `uploadStatus` on the track record and
auto-drain on reconnect via `uploadPendingGpsTracks()` — a second, divergent
offline mechanism. It was removed in favor of the unified queue. If you ever
catch yourself adding an entity-specific `pending`/`status` field plus a custom
reconnect drain, stop: use the queue instead.

## Reference

Canonical doc: `docs/offline-op-queue.md`. Worked example: `docs/gps-tracks.md`.
