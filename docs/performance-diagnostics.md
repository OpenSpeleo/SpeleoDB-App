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

`plan_schedule` includes worker-side coordinate enumeration and deduplication
(the sorted rectangle-union sweep for current areas, bounded packed-key planning
for legacy inputs), plus durable writes of the final compact plan chunks. It
does not include tile-provider downloads. For a typical 12,000-coordinate plan,
only six final chunk transactions are required. A large value therefore points
to planner computation or final plan persistence rather than temporary
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

## Preserve async ordering while measuring

An async timing wrapper adds a promise-settlement boundary and can change
admission, cancellation, or supersession ordering. In sensitive orchestration,
record the monotonic start synchronously before the existing `await` and
completion synchronously after it. Keep the active phase in the caller so its
existing catch path reports abort/failure without an extra promise. Verify the
owning cancellation and overlap tests as well as emitted diagnostic fields.

## Evidence for performance claims

Define user-visible start and terminal boundaries and compare the same
representative workload before and after the change. Record raw wall-clock
samples, median, worst result, time to first useful publication, long tasks, and
retained large-payload ownership. Operation counts, complexity, and concurrency
are supporting evidence; storage contention, cloning, garbage collection,
rendering, worker startup, and WebView scheduling can reverse their apparent
benefit. Revert or redesign changes that regress elapsed time or responsiveness.
Use sanitized production phase timings for device confirmation where desktop
benchmarks cannot model the platform.

Load-sensitive build-speed advisories do not belong in tests whose contract is
artifact correctness. Disable only that advisory through the build tool's scoped
test configuration; keep normal production advisories and the repository console
guard enabled. Do not mute `console.warn` globally.

## Project-sync measurement limits

The project-cache optimization shares validated records through a 64-entry LRU,
weakly memoizes derived depth data, batches ready map publication, and overlaps
independent metadata phases. The owning architecture is documented in
[project sync](project-sync-coordination.md) and
[Dashboard data](dashboard-map-data.md).

The recorded desktop comparison used 60 projects with 2,000 3D point features
each (18.1 MiB total), five samples, fake IndexedDB, React publication, and
explicit garbage collection. It did not reproduce the reported phone slowdown.
That historical comparison is not a current-build device speed claim: real
WebKit storage, worker startup/structured cloning, and MapLibre commit-to-paint
must be measured on the affected workload using the granular timings above. The
physical regression remains unverified by that desktop evidence.

Combining project MapLibre sources is a separate architectural decision. It
changes visibility, color, depth, hit-testing, and source ownership; undertake
it only if post-fix measurements identify reconciliation, rather than storage,
as the remaining cost. Operation-count reductions alone do not justify it.
