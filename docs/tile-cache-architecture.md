# Tile Cache and Offline-Map Synchronization

## Intent and ownership

Raster reads and offline coverage preparation are separate correctness domains.
MapLibre must be able to read usable bytes without waiting for network or
offline-map bookkeeping. Rolling replacement must never discard the last active
coverage until every required source and tile in its replacement is valid.

- `TileCacheService` owns the `cached-https` protocol, stale-while-revalidate,
  the end-to-end tile deadline, response validation, and runtime cache epochs.
- `OfflineMapPlanner` and its worker enumerate canonical coordinates.
- `OfflineMapSyncEngine` owns immutable plans, layer generations, bounded audit
  and download work, retries, checkpoints, and the progress store.
- `TileCacheRepository` owns IndexedDB schema, transactions, migration,
  activation/release, statistics, recovery, and garbage collection.
- `TileCoordinator` owns source completeness, request supersession, layer
  enable/disable orchestration, storage consent, and logout integration.

## Runtime cache contract

`cached-https` reads payload and metadata together in one readonly transaction.

- A fresh tile returns locally with no HTTP request.
- A stale tile returns immediately and enters one deduplicated, serialized,
  low-priority refresh lane. Failed refresh preserves the old bytes.
- Each refresh owns an abort controller and captures the cache epoch. Cache
  clear/logout aborts it; an ignored transport abort cannot publish into a new
  epoch.
- A miss has one 10-second deadline covering headers, body consumption,
  content-type checks, non-empty validation, SHA-256, cancellation, and the
  decision to persist. Late transport settlement is consumed but cannot write.
- Configured raster URLs accept image content types or
  `application/octet-stream`. HTTP errors and invalid/empty payloads are
  failures, never no-data answers.
- A verified provider no-data raster becomes a zero-byte, freshness-aware
  tombstone. Hashes live on `MapLayerDefinition`; the known fingerprint applies
  only to satellite. Both hillshade lists are empty pending independent proof.
  If a configured hash cannot be computed, validation fails closed.

Warm-tile and cached-viewport p95 values are release-device targets, not claims
established by jsdom, fake IndexedDB, simulator builds, or fake timers.

## Fail-closed source collection

A replacement plan is all-or-nothing. Validated current-commit project records,
valid empty overlays, and matching current quarantines are resolved inputs.
Transient storage reads, missing current project commits, invalid/missing
overlay records, unavailable SHA-256, or server GPS geometry that cannot be
matched to the current server SHA abort planning. The active generations remain
untouched.

Ordinary map display may use legacy cached GPS geometry. Planning may not: stale
server geometry is refreshed with three-way bounded concurrency, and a missing
SHA, URL, valid response, or successful cache write fails the whole replacement.

Source identity is an asynchronous SHA-256 over sorted, length-delimited input
parts. `TileCoordinator` assigns every request a monotonic ownership version, so
an older source read cannot supersede newer geometry, layer preferences, or a
refresh even when the older dependency ignores cancellation.

Project-sync preparation is queued on a later WebView task after foreground data
publication. Project cache records are read through a four-worker bounded pool
rather than one serial chain. Source conversion yields between local batches,
and cancellation is rechecked after every yield. The planner remains a dedicated
worker; these boundaries prevent offline preparation from owning the Settings
spinner or monopolizing rendering/input on the WebView thread.

## Bounded in-memory plan construction

The dedicated worker packs each `{z,x,y}` coordinate into one safe integer and
deduplicates it in a worker-local `Set<number>`. The plan has a hard ceiling of
1,000,000 unique coordinates; exceeding it fails planning before any final chunk
or manifest is published. The final keys are copied into a `Float64Array`,
sorted in place, decoded into compact `Uint32Array` chunks of at most 2,048
coordinates, and transferred one chunk at a time.

The worker waits for explicit consumer acknowledgement before producing the next
final chunk. Acknowledgement follows the chunk's durable IndexedDB write, so the
plan path performs one transaction per final chunk rather than one object-store
write per raw coordinate. Requests and acknowledgements use discriminated `plan`
and `ack` messages; the production-worker protocol is tested directly rather
than only through the test-only main-thread fallback. The immutable manifest is
committed last. Therefore:

`expected tiles = unique coordinates (N) * enabled layers (M)`

Builders have unique IDs. The unique source-revision index chooses one winner; a
loser reuses that winner and discards its own chunks. Startup deletes legacy v8
staging rows and chunk-only builds. Structurally corrupt manifests are deleted
and rebuilt. Old unreferenced manifests and chunks are collected in bounded
batches after a grace period.

The temporary memory envelope is intentionally bounded. At the 1,000,000-tile
ceiling, the JavaScript hash set plus sorted typed array is expected to consume
roughly 43-69 MiB depending on the WebView engine; a typical 12,000-tile plan is
well below 1 MiB. Output chunks are transferred and released incrementally.

## IndexedDB v8 and migration

`speleo_tiles` v8 is additive to v7 payload, metadata, generation, and
membership data:

| Store                          | Purpose                                              |
| ------------------------------ | ---------------------------------------------------- |
| `offline_map_plans`            | immutable manifest and unique cryptographic revision |
| `offline_map_plan_chunks`      | sorted compact coordinate chunks                     |
| `offline_map_plan_coordinates` | legacy v8 crash staging; cleared during recovery     |
| `offline_map_generations`      | pending/active/failed/releasing layer state          |
| `offline_map_memberships`      | generation claim per provider URL                    |

The resumable v6 ownership migration remains private repository machinery. It
runs in 250-record transactions, never rewrites/deletes tile payloads, preserves
valid freshness, assigns migration time only where freshness is missing, and
converts legacy owners into active per-layer generations. No production API can
create or reconcile v6 owner records.

Preload publishes “Preparing offline maps,” completes migration and crash
recovery, persists normalization only for invalid counters, then publishes
active coverage. Pending, failed, and releasing generations are reclaimed.
Cleanup failure remains durable and is retried after restart.

## Download and generation pipeline

Plans are audited in 16-coordinate transactions. Six workers consume a
backpressured queue with no more than 64 total outstanding coordinates; ready
work and delayed retries are therefore each bounded by 64. Layer IDs and URL
templates must be unique. Satellite coordinates are produced before optional
layers.

- Fresh payloads/tombstones are claimed without network.
- Missing, stale, and forced entries use six workers.
- Retry timers do not occupy worker slots. Only transport errors, 408, 429, and
  5xx retry; other 4xx and invalid payloads terminate the coordinate.
- Payload and tombstone commits attach abort directly to the IndexedDB
  transaction and recheck signal/generation before final metadata/statistics.
- Payload↔tombstone replacement, shared membership, concurrent capacity writes,
  release, and prefix eviction update aggregate statistics transactionally.
- Activation returns every prior active generation. A failed replacement never
  activates and releases only its pending memberships.

Enabling an optional layer uses a discriminated active-plan reuse request. Only
`OfflineMapPlanUnavailableError` permits fallback to full source planning.
Disabling cancels the multi-layer session, releases that layer successfully,
then evicts its URL namespace, refreshes statistics, and resumes remaining
layers from the active satellite plan. Release failure prevents eviction and
rolls back the preference.

## Progress and Settings

The snapshot exposes normalized audited, queued, completed, failed, cached,
downloaded, active-worker, byte, throughput, ETA, and per-layer counters.
Completed and failed are mutually exclusive and cannot exceed each layer total.
Audit/commit/failure transitions update the in-memory snapshot independently of
durable checkpoints. Checkpoints serialize at most once per second and at phase
transitions; worker dispatch never awaits them.

`OfflineMapSyncStore` is safe with synchronous, delayed, or frozen animation
frames and has a 50 ms fallback. It snapshots listeners, honors removals, defers
additions to the next event, isolates observer exceptions, and cancels scheduled
work on disposal.

Settings uses `useSyncExternalStore`; tile progress never enters the app-wide
context. **Tiles synced** is the only overall counter. Initial migration shows
“Preparing…”. Rolling refresh shows replacement progress while the old
generation remains an internal availability guarantee. Failed coordinates are
shown overall and in affected layer subtitles, so failure cannot resemble
completion.

## Verification and release evidence

Authoritative automated seams include planner deduplication/limit enforcement,
acknowledgement/final-chunk bounds, legacy v8 staging recovery/GC, real
fake-IndexedDB aborts, payload/tombstone statistics, six-way concurrency and
queue high-water marks, retry classes, deadline phases, late refresh/logout
races, request supersession, paint scheduler hostility, context isolation, and
Settings failure presentation.

Deterministic fake-time evidence establishes six active workers, dispatch gaps
no greater than 100 ms under controlled 100 ms latency, completion faster than
four times the serial baseline, a 64-coordinate outstanding high-water mark, and
progress notification within 50 ms when RAF is frozen. The fresh-plan path
proves one manifest lookup and zero audit, write, or network work.

Physical Android/iOS p95 timings plus slow-network, airplane-mode, restart,
interruption, storage, layer-switching, and zero-network viewport checks remain
release blockers until recorded on attached devices. Builds/simulators do not
satisfy those gates.
