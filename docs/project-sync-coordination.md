# Project synchronization coordination

## Intent

Project synchronization is a state machine, not a collection of controller
helpers. It must preserve cached data on partial failure, reject stale async
completion, validate untrusted geometry before publication, and keep offline
mutation ownership separate from server overlay refresh.

`SpeleoDBController` remains the public UI façade. Three focused modules own the
project-sync behavior:

- `ProjectSyncCoordinator` owns project-list state, sync status, last-sync time,
  run cancellation, phase ordering, post-GeoJSON map-data revision, and
  publication.
- `ProjectGeoJSONCoordinator` owns per-commit download, normalization, worker
  validation, durable quarantine, session-only fail-closed disposition, warning
  acknowledgement, and active map-data reads.
- `ProjectOverlaySyncCoordinator` owns read-only overlay refresh and protects
  the landmarks ground truth while pending mutations exist or replay is active.

All production modules remain below the 600-line limit. Tile preparation is
queued through `TileCoordinator`; GPS refresh remains an injected hook until GPS
ownership is extracted in the next objective.

## Phase contract

One run proceeds in this order:

1. Load the cached project list and publish it immediately when present.
2. If offline-locked or credentials are absent, validate eligible cached legacy
   GeoJSON locally, skip outbound phases, and publish a terminal revision.
3. Fetch the project list. Only `2xx + Project[]` replaces in-memory state;
   malformed success and failed responses preserve the cached list.
4. Validate project GeoJSON through the bounded three-worker pool.
5. Publish the map-data revision immediately after durable project GeoJSON
   processing. Dashboard can progressively load those records while overlays and
   GPS continue.
6. Refresh shared overlays and GPS metadata concurrently; each publishes from
   its owning durable boundary, and foreground completion waits for both.
   Writable landmark-collection metadata runs concurrently with the five
   independent overlay fetch/write paths. Landmark GeoJSON remains skipped when
   pending mutations could be overwritten.
7. Mark foreground synchronization complete and queue offline-map preparation on
   a later task. `TileCoordinator` owns its cancellable lifecycle, collects
   current sources, and admits the immutable plan without holding the Settings
   button or the project-sync promise.

## Timing diagnostics

Every run emits structured `console.log` records under `[project-sync:timing]`.
Each browser record contains `runId`, `phase`, `durationMs`, `status`, and, for
coordinator phases, `reason`. Executed phase durations use the monotonic
`performance.now()` clock and are rounded to a tenth of a millisecond. A phase
that was intentionally skipped has `durationMs: null`; an admitted phase that
failed or was superseded retains its measured duration and reports `failed` or
`aborted`. Exactly one `total` record is emitted for every run, including
superseded runs.

The coordinator emits phases in the following stable diagnostic order. Overlay
and GPS measurements overlap in wall-clock time, then their records are emitted
in this order after both settle; the total therefore includes their maximum
duration rather than their sum.

| Phase             | Timed work                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `cache_load`      | Read and publish the cached project list.                                                                                |
| `project_refresh` | Fetch and validate the server project list, persist it, and publish it.                                                  |
| `geojson_sync`    | Resolve project commits, download changed GeoJSON, validate it, and durably publish or quarantine it.                    |
| `overlay_sync`    | Fetch and persist the shared overlays plus writable landmark-collection metadata allowed by pending-mutation protection. |
| `gps_sync`        | Fetch GPS metadata and durably reconcile its cache.                                                                      |
| `tile_prefetch`   | Queue background offline-map preparation (`durationMs: null`, reason `tile_prefetch_queued`).                            |
| `total`           | Foreground sync from cache load through durable project, overlay, and GPS publication.                                   |

The queued work later emits two records under `[offline-map:timing]` with the
same `runId`:

- `coverage_source_collection` includes IndexedDB reads for landmark, station,
  validated project, and GPS coverage plus construction and hashing of the
  source revision.
- `plan_schedule` includes lazy engine loading, plan lookup or worker-based plan
  generation, plan-chunk persistence, stale-generation cleanup, and durable
  admission of the new layer generations.

`geojson_sync` also emits five aggregate work totals under
`[project-geojson:timing]`: cache reads, download/JSON decoding, normalization,
worker validation/structured-clone, and durable cache writes. These totals make
physical-device WebKit and IndexedDB costs visible without logging any project
identity or payload. See `performance-diagnostics.md` for interpretation.

Neither source collection, plan admission, nor tile HTTP downloads hold
`syncStatus === 'syncing'`; their progress remains in the offline-map store. The
timing records deliberately exclude credentials, instance URLs, project
identifiers and names, response bodies, GeoJSON, and cached payloads. This makes
them safe for performance diagnosis without turning the console into a user-data
export. Native builds additionally forward only the fixed `scope`, `runId`,
`phase`, `durationMs`, and `status` fields to the first-party performance
diagnostics plugin. The plugin validates every value against a closed allowlist
before writing to OS logging; even the browser-only `reason` field is not
forwarded. See `performance-diagnostics.md` for filters and the security
boundary.

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

Offline-map preparation begins on a later WebView task so the foreground state
change can paint first. Project coverage records use four-way bounded reads;
source conversion yields between local batches; immutable plan enumeration
remains in its worker. The six-worker download pipeline continues through its
dedicated store. Per-tile progress does not publish a project/controller state
change, so project sync subscribers do not rerender for map downloads.

Validated project-record reads are shared through a 64-entry, session-scoped LRU
in `ProjectCacheService`. Reconciliation, Dashboard publication, and a
revision-only reload therefore share one IndexedDB structured clone per project
instead of rereading the same large value. Concurrent first readers use one
single-flight promise, while cancellation remains caller-scoped. Validated,
legacy, quarantine, and acknowledgement entries change only after their durable
transaction completes; failed writes retain the prior in-memory truth. A write
version prevents an older in-flight read from replacing a newer commit.

The flow adds no requests or retries. Independent overlay, landmark-collection,
and GPS requests overlap after the project GeoJSON durability boundary, so a
slow endpoint no longer delays admission of unrelated work. Cancellation is
shared across the concurrent work, both settlements are observed, and stale
results retain the existing publication guards. A cold process still performs
the one GeoJSON read required to render each eligible project, but repeated
consumers reuse that immutable record. GeoJSON reconciliation concurrency
remains capped at three; offline-map project-record reads are capped at four;
project arrays and warning arrays retain stable identity when their contents do
not change.
