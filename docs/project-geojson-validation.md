# Project GeoJSON Validation and Quarantine

## Feature intent

Project survey GeoJSON is untrusted remote data. A malformed coordinate or a
world-scale survey bbox can make map fitting unusable and can expand offline
tile prefetch from a local survey to an enormous download. Every project file
therefore passes one validation boundary before any map or prefetch consumer can
see it.

The project record itself is never disabled. Quarantine applies only to the
GeoJSON file identified by `(project id, latest_commit.id)` so project metadata
and unrelated synchronization continue normally.

## Threat model and ownership boundary

The validator protects three expensive or user-visible operations from remote
survey bytes:

- map fitting, where one extreme coordinate can move every useful survey off
  screen;
- offline tile planning, where a large bbox can generate an impractical number
  of network and cache operations;
- repeated main-thread coordinate scans, where a pathological payload can make
  the Dashboard unresponsive.

It does not validate server project metadata or global overlay feeds, and it
does not attempt to repair questionable coordinates. Rejecting the complete file
is intentional: silently omitting one dangerous geometry would make the
displayed survey differ from its source without telling the user.

## Policy

The source of truth is `PROJECT_GEOJSON_VALIDATION` in `src/constants.ts`:

- unpadded width must be at most 100 km;
- unpadded height must be at most 100 km;
- the corresponding Web-Mercator x/y footprint must be at most 100.12 km;
- analysis must return before the 10-second resource deadline;
- every longitude/latitude must be finite and inside the legal GeoJSON range;
- the FeatureCollection must contain at least one usable coordinate.

Exceeding either size limit quarantines the file. Exactly 100 km is accepted.
Dimensions use haversine distances over the shortest longitude interval, so a
small survey crossing the antimeridian is not interpreted as nearly global. Tile
padding and Dashboard fit padding are applied only after validation and do not
affect the threshold.

The projected-footprint check is a second consumer-safety boundary. A compact
raw bbox near a pole can become enormous after Web-Mercator projection even
though its haversine dimensions are below 100 km. Such a file fails with
`bbox_error` before map fitting or tile planning. The 100.12 km projected cap
accounts for Web Mercator's slightly larger spherical radius and preserves an
exactly 100 km equatorial bbox; it is not a larger raw-data allowance.

The longitude interval is the complement of the largest gap between sorted
longitudes on a circle. Shared directed-interval utilities preserve complete
arcs (including antimeridian arcs) when Dashboard combines bounds and when tile
planning adds padding; they do not merge only the two endpoints. Width is the
haversine distance from west to east at `(south + north) / 2`; height is the
haversine distance from south to north at a constant longitude. Machine roundoff
immediately at the 100 km boundary is snapped to the limit so the policy remains
strict `> 100 km`. The analyzer reads the first two ordinates of a position, so
altitude and later ordinates do not affect the bbox.

## Worker boundary

`ProjectGeoJSONAnalyzer` creates an explicitly bundled module worker. The
deadline begins before worker construction and includes construction,
`postMessage`, structured cloning, computation, and response receipt. Elapsed
time is checked after construction, after posting, and before accepting a
response; if startup already consumed the budget, the payload is never posted.
Every terminal path clears the timer and handlers and terminates the worker.
Worker errors are consumed at this boundary rather than escaping to global
handlers. Sync cancellation is connected through `AbortSignal`, preventing a
superseded sync or logout from publishing late cache writes or warnings.

The worker runs the pure analyzer in `projectGeoJSONBounds.ts`, which supports
all GeoJSON geometry types and nested GeometryCollections. Null geometries are
ignored. Malformed nesting, an unsupported geometry, or any bad position fails
the file rather than silently dropping the coordinate.

A computation error caused by the file is quarantined. Worker responses are
runtime-validated; deadlines, malformed or foreign responses, worker asset
failures, and platform/bootstrap failures are infrastructure failures classified
as `validation_unavailable`. Infrastructure failures hide the file and cancel
its prefetch work for the current process, but are never written through the
durable quarantine API or permanently attributed to the file commit.

Failure diagnostics are explicitly partial: bounds, width, and height are null
until actually measured, while a safe elapsed duration is retained when one is
available. Timeout or projection failures may therefore report duration and a
completed measurement without inventing missing values.

## Cache state machine

Project GeoJSON continues to use its existing key in the `geojson` IndexedDB
store; no database-version migration is required. Validation metadata schema
version 2 distinguishes:

- **legacy**: pre-feature entry without validation metadata;
- **active**: normalized FeatureCollection plus validated bounds, dimensions,
  duration, schema version, and commit ID;
- **quarantined**: `data: null`, commit ID, a file-scoped reason, partial
  diagnostics, and the warning acknowledgement flag;
- **missing**: no cache entry.

Every metadata field is validated before a record becomes active: state,
non-empty commit ID, schema version, finite/ranged directed bounds, raw and
projected limits, duration, reason, diagnostics, and acknowledgement. Corrupt or
incomplete metadata is treated as legacy, never active.

A legacy entry carrying a commit ID that matches `latest_commit.id` is audited
from its cached bytes and rewritten, including during offline startup or when a
project refresh fails. An unversioned legacy entry has no trustworthy commit
identity: it remains fail-closed offline and is never attributed to the current
server commit. It is replaced only by an online 2xx download of that canonical
commit.

For the same active commit, sync logs and reuses stored bounds without
recomputing. For the same quarantined commit, sync performs no download or
analysis, except for historical `bbox_timeout` records written by clients using
the old 500 ms policy. Those records are retained until an online retry of the
same commit validates and atomically replaces them. A newer `latest_commit.id`
is a new file version and is validated normally; a valid replacement atomically
reactivates the project map layer.

If IndexedDB cannot persist quarantine, the controller retains a session-only
typed per-commit disposition. Read failures and validation-infrastructure
failures use the same session boundary. It prevents display, prefetch, repeated
download, and repeated analysis in the current process while retaining the
reason and available diagnostics for consistent logging/warnings. A later launch
may retry because durable suppression cannot be guaranteed without storage.

### Per-commit transitions

| Current record                | Observed commit  | Action                                                          | Result                                           |
| ----------------------------- | ---------------- | --------------------------------------------------------------- | ------------------------------------------------ |
| Active                        | Same             | Log stored analysis; no download or analysis                    | Active                                           |
| Quarantined content failure   | Same             | Remove prefetch target; no download or analysis                 | Quarantined                                      |
| Historical timeout quarantine | Same, online     | Download and validate again                                     | Active, content-quarantined, or session-disabled |
| Historical timeout quarantine | Same, offline    | Retain warning; do not download                                 | Quarantined                                      |
| Legacy with matching commit   | Same             | Analyze cached bytes, online or offline                         | Active or quarantined                            |
| Unversioned legacy            | Offline          | Hide; do not assign bytes to current commit                     | Session-disabled                                 |
| Unversioned legacy            | Online           | Download canonical current commit; do not audit ambiguous bytes | Active or quarantined                            |
| Missing/stale                 | New, online      | Download, normalize, then analyze                               | Active or quarantined                            |
| Missing/stale                 | New, offline     | Do not infer a file failure from network absence                | Unchanged                                        |
| Any                           | New valid commit | Atomically write active data and clear stale warning            | Active                                           |

### Failure matrix

| Failure                                          | File scoped          | Durable quarantine                   | Warning                        | Retry                   |
| ------------------------------------------------ | -------------------- | ------------------------------------ | ------------------------------ | ----------------------- |
| Width or height over 100 km                      | Yes                  | Yes                                  | Measured dimensions            | New commit only         |
| 10-second validation deadline                    | No                   | No                                   | Available duration/measurement | Later process           |
| Historical persisted timeout                     | No longer trusted    | Existing record retained until retry | Available duration/measurement | Same commit when online |
| Invalid geometry/position                        | Yes                  | Yes                                  | Safe-computation summary       | New commit only         |
| No usable coordinates                            | Yes                  | Yes                                  | Safe-computation summary       | New commit only         |
| Analyzer computation throw                       | Yes                  | Yes                                  | Safe-computation summary       | New commit only         |
| Worker asset/bootstrap/malformed-message failure | No                   | No                                   | Available duration             | Later process           |
| Project cache read failure                       | No                   | No                                   | Session-disabled summary       | Later process           |
| Quarantine cache write failure                   | Undetermined durably | No                                   | Session-disabled summary       | Later process           |
| HTTP/transport failure or abort                  | No                   | No                                   | No GeoJSON warning             | Normal sync retry       |

## Sync counters

GeoJSON phase counters describe different axes and intentionally overlap:

- `eligibleProjectCount`: server projects with a GeoJSON file and without
  `exclude_geojson`;
- `downloadedProjectCount`: every successful HTTP 2xx file response, even when
  subsequent normalization or validation rejects its payload;
- `validatedProjectCount`: a newly analyzed record that was accepted and
  persisted active (cache-hit active records are not counted again);
- `quarantinedProjectCount`: each final durable quarantine or session-disabled
  disposition reported by the run;
- `skippedProjectCount`: no file download or analysis was attempted because the
  existing disposition was reused or offline policy prevented work; and
- `failedProjectCount`: the project did not finish usable in that run.

A reused quarantine/session block therefore increments quarantined, skipped, and
failed. A newly rejected download increments downloaded, quarantined, and
failed. This overlap is deliberate; the values must not be treated as a
partition of eligible projects.

Per-project failures are contained inside the three-worker pool. They can make
the GeoJSON phase a partial failure, but do not roll back a successful project
list refresh or prevent unrelated overlay synchronization.

## Consumer boundary

`ProjectGeoJSONCoordinator` exposes active map data through the controller
façade atomically as `{ commitId, featureCollection, bounds }`. It returns null
for legacy, quarantined, session-disabled, missing, or non-current commits. A
stable `mapDataRevision` is published as soon as the GeoJSON phase reaches its
durable boundary, before overlay, GPS, or offline-map work. Initial/offline and
Settings-triggered paths use the same boundary. `useDashboardMapData` reloads on
that revision, progressively publishes each project map-data record, and
requires each loaded `commitId` to equal the project's `latest_commit.id`. It
immediately filters an old commit when the project list advances, before a
replacement cache read resolves. If a sync or consumer read is superseded, stale
success and failure completions cannot publish; the replacement publishes the
next terminal revision. See `docs/dashboard-map-data.md`.

Dashboard uses stored bounds for project zoom and combined initial fit; it does
not walk project coordinates. Combined fit unions complete directed longitude
intervals, then clamps display latitudes to the finite Web-Mercator range.
Effective project visibility is intersected with current active map data,
removing quarantined/stale files from sources, layers, the Project panel, depth
coloring/probing, fit/zoom, progress, and project-linked overlays. Persisted
visibility remains user intent independent of temporary map-data availability,
so a valid replacement commit can reappear without a reload.

Tile prefetch accepts `ProjectGeoJSONBounds`, never project GeoJSON. Quarantine
calls `removeTarget(projectId)`, which removes jobs across every layer, prunes
the target from shared queued URLs, and aborts a solely-owned in-flight request.
Target generations plus serialized job persistence make removal linearizable:
stale cache checks, enqueues, status writes, retry waits, and persistence writes
cannot recreate the removed target. A shared active download continues for its
remaining owners; a solely-owned one aborts. Job-deletion failure is logged and
the runtime tombstone remains fail-closed. Already-cached tiles are retained
because a URL can be shared by another project.

## Diagnostics and warning UX

When an eligible project reaches an active, quarantined, or session-disabled
disposition, `ProjectGeoJSONCoordinator` emits a structured device-console
record under `[project-geojson:bbox]`, including name, ID, commit,
cache/computed source, available dimensions/duration, status, and failure
reason. A transport failure before validation has no bbox disposition and uses
the ordinary sync warning. Active records use `console.info`; disabled records
use `console.warn`. These diagnostics are not sent to Sentry.

The structured payload is:

```text
{
  projectId, projectName, commitId,
  source: "computed" | "cache",
  widthKm, heightKm, durationMs,
  status: "active" | "quarantined",
  reason?
}
```

Unacknowledged quarantine warnings are persisted per commit and aggregated in a
global **Project map data disabled** modal. Each entry includes project name,
project ID, and a reason-specific summary. The coordinator exposes one effective
startup-modal slot with priority: offline/auth gate, companion onboarding,
GeoJSON warning, then storage consent. Priority suppression is not user
acknowledgement. The GeoJSON warning rejects backdrop, escape/back, gesture, and
uncontrolled programmatic dismissal; it can close only after successful
acknowledgement, valid recovery/removal of the warnings, or controlled
suppression by a higher-priority gate.

Acknowledgement uses a single IndexedDB read/write transaction and replaces the
record only if its commit and complete v2 quarantine metadata still match. An
old modal therefore cannot acknowledge a newer commit. The controller returns
explicit acknowledged/failed counts; the button shows a busy state and any
persistence failure remains visible while the failed warning stays open. Warning
snapshots are deduplicated by project and commit; re-publishing the same state
does not churn React snapshot identity. When a project advances to another
faulty commit, the current warning replaces the stale one. A valid newer commit
removes it.

## Performance implications

- Coordinate traversal and longitude sorting occur off the UI thread.
- Valid bounds are computed once per commit and reused by every consumer.
- Quarantined payload bytes are discarded from the project cache.
- The sync download worker pool remains capped at three, which also bounds
  concurrent validation workers.
- Worker startup and structured cloning are included in the 10-second deadline.
- IndexedDB writes and conditional updates are abort-aware; cancellation aborts
  the active transaction where possible and always wins at the service boundary.
- Directed-interval merging operates on the small set of project bounds rather
  than rescanning every coordinate in Dashboard.

## Verification strategy

Final command results and counts belong in the task review, not this design
document. Required automated coverage is:

- Pure geometry tests for all geometry shapes, antimeridian behavior, invalid
  positions, no-coordinate input, threshold boundaries, and the 8,000 km
  regression.
- Worker tests for success, timeout, abort, cleanup, typed file errors, and
  infrastructure failure.
- Persistence tests using fake IndexedDB at the transaction boundary for strict
  v2 parsing, abort-aware writes, commit-conditional acknowledgement, and
  restart behavior; higher-level mocks alone are insufficient evidence.
- Cache/controller tests for matching-commit legacy audit, unversioned
  fail-closed behavior, durable/session dispositions, same-commit suppression,
  newer-commit recovery, cancellation ordering, and exact counter overlap.
- Tile tests for bounds-only planning, padding/deduplication, antimeridian and
  polar cases, plus cross-layer target-removal races around cache checks,
  persistence, retry sleep, and shared/sole active requests.
- React tests for modal priority/content and the absence of quarantined map and
  panel data.
- Web and native compilation verify packaging feasibility. They do not prove
  WebView responsiveness, device-console behavior, persistence across a real
  force-quit, or network cancellation; those remain device checks below.

## Manual device verification

Before release, verify on both an Android device and an iOS device:

1. A normal project emits the structured active bbox record in the device
   console and appears in the panel/map.
2. The 8,000 km fixture emits a quarantined record and an aggregated warning
   with project name, ID, dimensions, and limit.
3. The faulty survey is absent from panel, sources/layers, depth participation,
   initial fit, row zoom, and project-linked overlays.
4. Network diagnostics show no satellite or optional-layer tile requests owned
   by the faulty project.
5. An intentionally hung worker times out near 10 seconds without freezing map
   interaction.
6. Force-quit and relaunch, including offline launch: the same quarantined
   commit is not downloaded or analyzed and an unacknowledged warning returns.
7. Acknowledge, force-quit, and relaunch: the same warning does not return.
8. Publish a newer compact commit and resync: the project returns to panel/map
   and becomes eligible for tile prefetch without restarting the app.
9. Seed a historical 500 ms timeout marker and reconnect: the same commit is
   downloaded, validated, and atomically restored when its content is valid.
