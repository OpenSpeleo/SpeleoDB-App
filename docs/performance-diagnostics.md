# Performance diagnostics

## Intent

Synchronization timings must be visible where engineers diagnose a physical
device without enabling Capacitor's global bridge logging. Global logging stays
disabled because it can print arbitrary plugin arguments, including sensitive
application data. SpeleoDB instead uses a first-party diagnostic bridge whose
schema is intentionally too narrow to carry requests, payloads, or credentials.

## Record contract

The web layer emits `[project-sync:timing]`, `[project-geojson:timing]`,
`[dashboard-map:timing]`, and `[offline-map:timing]` records through
`console.log`. On iOS and Android, the same call also sends exactly five fields
to `PerformanceDiagnostics`:

- `scope`: `project-sync`, `project-geojson`, `dashboard-map`, or `offline-map`;
- `runId`: a non-negative synchronization generation;
- `phase`: one of the documented project-sync or offline-map timing phases;
- `durationMs`: a finite non-negative number, or `null` for skipped/queued work;
- `status`: `applied`, `skipped`, `aborted`, `failed`, `done`, or `error`.

The native formatter rejects unknown scopes, phases, statuses, invalid run IDs,
negative durations, and non-finite durations. Native output never contains the
browser-only reason, project/track IDs or names, URLs, coordinates, GeoJSON,
headers, request bodies, response bodies, tokens, or passwords. A diagnostic
bridge rejection is contained and cannot fail synchronization.

## Viewing timings

The diagnostic plugin is native code, so install a build containing it before
collecting logs; replacing only the web bundle is insufficient.

- Browser development: filter the developer console for `:timing]`.
- iOS/Xcode: run the app from Xcode, open the debug console, and filter for
  `SpeleoDBPerformance`. The OSLog category has the same name.
- Android Studio: filter Logcat by tag `SpeleoDBPerformance`.
- Android command line: `adb logcat -s SpeleoDBPerformance:I '*:S'`.

Example native line:

```text
[project-sync] run=7 phase=project_refresh durationMs=12.3 status=applied
```

The foreground `total` ends after durable project, overlay, and GPS publication.
Offline-map `coverage_source_collection` and `plan_schedule` are separate
background timings and do not keep the Syncing action active.

`plan_schedule` includes worker-side coordinate enumeration, packed in-memory
deduplication and sorting, and durable writes of the final compact plan chunks.
It does not include tile-provider downloads. For a typical 12,000-coordinate
plan, only six final chunk transactions are required. A large value therefore
points to planner computation or final plan persistence rather than temporary
per-coordinate staging, which is not part of the current planner path.

The `project-geojson` scope splits the local work hidden inside `geojson_sync`:

| Phase                | Measured boundary                                                                      |
| -------------------- | -------------------------------------------------------------------------------------- |
| `cache_read_work`    | Sum of authoritative project-record IndexedDB reads.                                   |
| `download_work`      | Sum of project response download and JSON decoding waits.                              |
| `normalization_work` | Sum of synchronous GeoJSON shape normalization.                                        |
| `validation_work`    | Sum of worker startup, structured-clone, bounds validation, and worker response waits. |
| `cache_write_work`   | Sum of validated or quarantined durable IndexedDB writes.                              |

These values are aggregate work totals across the bounded three-worker pool, so
their sum can exceed the wall-clock `geojson_sync` duration. That distinction is
intentional: the wall clock shows user delay while the work totals identify
which repeated boundary consumes it.

The `dashboard-map` scope emits `project_cache_read_work`,
`project_normalization_work`, and `project_total_to_paint`. The first two are
aggregate work totals. `project_total_to_paint` starts before the four project
readers and ends on the first animation frame after the final publication, so it
captures WebView scheduling, React commit, and MapLibre reconciliation delay
that storage-only desktop tests cannot model.

## Ownership and verification

`src/utils/performanceTiming.ts` owns browser emission and construction of the
native fixed-field record. Each platform owns a formatter and a native logging
adapter. Android registers the plugin in `MainActivity`; iOS registers an
explicit plugin instance in `AppBridgeViewController`, matching the app's
first-party Capacitor ownership boundary. Formatter tests prove known records
format consistently and unknown values do not reach OS logging. The iOS bridge
integration test proves the compiled plugin is actually callable, while the
TypeScript contract test proves optional diagnostic context is not forwarded.

Logging is best effort and performs no storage or network work. Timing uses
constant-memory numeric accumulators; no project identifier or payload is
retained for diagnostics. One short line is emitted per measured phase, so log
volume does not grow with projects, landmarks, tracks, sources, or tiles.
