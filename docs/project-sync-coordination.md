# Project synchronization coordination

## Intent

Project synchronization is a state machine, not a collection of controller
helpers. It must preserve cached data on partial failure, reject stale async
completion, validate untrusted geometry before publication, and keep offline
mutation ownership separate from server overlay refresh.

`SpeleoDBController` remains the public UI façade. Three focused modules own the
project-sync behavior:

- `ProjectSyncCoordinator` owns project-list state, sync status, last-sync time,
  run cancellation, phase ordering, terminal map-data revision, and publication.
- `ProjectGeoJSONCoordinator` owns per-commit download, normalization, worker
  validation, durable quarantine, session-only fail-closed disposition, warning
  acknowledgement, and active map-data reads.
- `ProjectOverlaySyncCoordinator` owns read-only overlay refresh and protects
  the landmarks ground truth while pending mutations exist or replay is active.

All three production modules remain below the 600-line limit. Tile scheduling is
an explicit `TileCoordinator` phase hook; GPS refresh remains an injected hook
until GPS ownership is extracted in the next objective.

## Phase contract

One run proceeds in this order:

1. Load the cached project list and publish it immediately when present.
2. If offline-locked or credentials are absent, validate eligible cached legacy
   GeoJSON locally, skip outbound phases, and publish a terminal revision.
3. Fetch the project list. Only `2xx + Project[]` replaces in-memory state;
   malformed success and failed responses preserve the cached list.
4. Validate project GeoJSON through the bounded three-worker pool.
5. Refresh shared overlays, skipping landmarks when pending mutations could be
   overwritten.
6. Refresh GPS metadata, then hand validated bounds/points/paths to
   `TileCoordinator`; it independently revalidates complete current planning
   inputs and schedules one cryptographically identified canonical plan through
   a monotonic abort-aware hook. Planning failure preserves active coverage and
   reports a failed tile phase rather than publishing a partial replacement.
7. Publish exactly one terminal map-data revision for the current run.

## Timing diagnostics

Every run emits structured `console.info` records under
`[project-sync:timing]`. Each record contains only `runId`, `phase`,
`durationMs`, `status`, and, for coordinator phases, `reason`. Executed phase
durations use the monotonic `performance.now()` clock and are rounded to a
tenth of a millisecond. A phase that was intentionally skipped has
`durationMs: null`; an admitted phase that failed or was superseded retains its
measured duration and reports `failed` or `aborted`. Exactly one `total` record
is emitted for every run, including superseded runs.

The ordered coordinator phases are:

| Phase | Timed work |
| --- | --- |
| `cache_load` | Read and publish the cached project list. |
| `project_refresh` | Fetch and validate the server project list, persist it, and publish it. |
| `geojson_sync` | Resolve project commits, download changed GeoJSON, validate it, and durably publish or quarantine it. |
| `overlay_sync` | Fetch and persist the shared overlay collections allowed by pending-mutation protection. |
| `gps_sync` | Fetch GPS metadata and durably reconcile its cache. |
| `tile_prefetch` | Collect the canonical coverage sources and admit the immutable offline-map plan. |
| `total` | The complete project-sync call from cache load through offline-map admission. |

`tile_prefetch` has two nested records under `[offline-map:timing]` with the
same `runId`:

- `coverage_source_collection` includes IndexedDB reads for landmark, station,
  validated project, and GPS coverage plus construction and hashing of the
  source revision.
- `plan_schedule` includes lazy engine loading, plan lookup or worker-based plan
  generation, plan-chunk persistence, stale-generation cleanup, and durable
  admission of the new layer generations.

Tile HTTP downloads start after `plan_schedule` resolves and therefore do not
hold `syncStatus === 'syncing'`; their progress remains in the offline-map
store. The timing records deliberately exclude credentials, instance URLs,
project identifiers and names, response bodies, GeoJSON, and cached payloads.
This makes them safe for performance diagnosis without turning the console into
a user-data export.

A superseding sync or logout aborts the active `CancellationContext`. Every
transport and cache seam receives its signal, and native best-effort transport
cannot publish after the context is aborted. A `4xx` project response does not
log out; non-`4xx` reachability failure enters offline mode without clearing
cached data.

## GeoJSON safety boundary

Downloaded or legacy bytes are never active merely because they parse. The
GeoJSON coordinator requires normalization, bounded worker analysis, commit
matching, and a successful atomic cache write. Invalid, oversized, timed-out, or
infrastructure-unverifiable data is removed from prefetch eligibility and either
durably quarantined or blocked for the process lifetime.

Warning state and session dispositions are pruned by current project/commit.
Acknowledgement is commit-conditional, so acknowledging an old warning cannot
hide a replacement file's failure.

## Verification and performance

The existing controller characterization suite exercises orchestration, response
classes, cached fallback, overlapping runs, logout races, exact phase counters,
quarantine persistence, warning identity, overlay protection, and tile/GPS hook
ordering through the public façade. Geometry, worker, cache, and tile seams
retain their dedicated tests.

Offline-map scheduling resolves once its immutable denominator and layer
generations are installed; the six-worker download pipeline continues through
its dedicated store. Per-tile progress does not publish a project/controller
state change, so project sync subscribers do not rerender for map downloads.

The extraction adds no requests, retries, timers, or scans. GeoJSON concurrency
remains capped at three; project arrays and warning arrays retain stable
identity when their contents do not change.
