# GPS track coordination

## Intent and ownership

GPS tracks combine local crash-recovery records, cached server metadata, lazy
geometry, GPX generation, and offline mutations. Treating that as controller
incidental state made cancellation, persistence ordering, and optimistic folds
too easy to change accidentally.

`SpeleoDBController` remains the public façade. The focused owners are:

- `GpsTrackCoordinator`: local and remote ground truth, identity-stable UI
  snapshots, serialized local persistence, startup restoration, GPX preparation,
  lazy GeoJSON download/cache, and logout invalidation.
- `GpsTrackMutationCoordinator`: upload/edit/delete policy, retryable versus
  definitive response handling, offline enqueue, confirmed-result publication,
  standalone refresh, and abort-aware project-sync phase integration.
- `GpsRecordingCoordinator`: only the active recording/watch state machine. It
  writes and publishes completed tracks through `GpsTrackCoordinator` ports.
- `OfflineMutationCoordinator`: durable operation ordering, coalescing,
  optimistic folds, conflict resolution, and replay.

## Ground-truth and publication invariants

- Local recordings live in `GpsTrackStore`; server metadata lives in
  `ProjectCacheService`. The UI list is derived from both plus the offline fold.
- The list snapshot is rebuilt only for a GPS recording, track, or queue change;
  unrelated controller notifications preserve its array identity.
- Incremental recording writes are serialized. Logout/discard invalidates their
  generation, and a late completed write removes itself.
- Startup loads publish only while their generation, authenticated session, and
  purge state remain current.
- Confirmed server edit/delete responses update the cache before publishing
  remote ground truth.
- Confirmed remote edits and deletes use one strict IndexedDB read-write
  transaction. A cache failure rejects the mutation without publishing a
  revision, removing a durable queue entry, or presenting the remote response as
  locally committed.
- Local record writes and deletions propagate storage failures. A failed delete
  remains visible for retry; a failed final recording write leaves the complete
  session paused and recoverable rather than announcing a save.
- Project-sync GPS metadata is cached, cancellation is checked, and only then is
  the new list published. A completion after cancellation cannot expose stale
  state.
- Remote geometry is cache-first, normalized before use, and fetched from the
  signed URL only with network access. Abort errors propagate; ordinary download
  failures remain a non-destructive cache miss.

## Mutation policy

- Local edit updates the local record and any queued create intent; local delete
  discards queued subject operations before removing the record.
- Online upload success removes the local record and refreshes server metadata.
- Online remote edit/delete publishes only confirmed results.
- Transport failures, `408`, `429`, and `5xx` enqueue durable intent. `429` does
  not mark the whole app offline; other reachability failures do.
- Definitive `4xx` responses surface their server message and are not queued.
- GPX and multipart preparation failures map to a definitive `422`-shaped replay
  response, preventing an invalid track from retrying forever.

## Verification and performance

`GpsTrackCoordinator.test.ts` and `GpsTrackMutationCoordinator.test.ts` each
achieve 100% statement, branch, function, and line coverage. They cover startup
races, persistence serialization, late-write cleanup, snapshot folds, local and
remote mutation paths, every retry class, queue persistence failure, response
error shapes, lazy geometry, cancellation commit gates, and logout reset.
`SpeleoDBController.test.ts` remains the public-façade integration seam.

`quality/release-documentation-contract.test.ts` separately prevents the native
release checklist from contradicting these persistence and replay invariants. It
does not replace the IndexedDB transaction, cancellation, or device tests that
own the behavior itself.

No polling or passive network listener is added. Snapshot rebuilding remains
limited to GPS revisions; geometry is downloaded once and cached; local writes
remain one serialized record per accepted recording fix.
