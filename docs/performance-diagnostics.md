# Performance diagnostics

## Intent

Synchronization timings must be visible where engineers diagnose a physical
device without enabling Capacitor's global bridge logging. Global logging stays
disabled because it can print arbitrary plugin arguments, including sensitive
application data. SpeleoDB instead uses a first-party diagnostic bridge whose
schema is intentionally too narrow to carry requests, payloads, or credentials.

## Record contract

The web layer emits `[project-sync:timing]` and `[offline-map:timing]` records
through `console.log`. On iOS and Android, the same call also sends exactly five
fields to `PerformanceDiagnostics`:

- `scope`: `project-sync` or `offline-map`;
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

## Ownership and verification

`src/utils/performanceTiming.ts` owns browser emission and construction of the
native fixed-field record. Each platform owns a formatter and a native logging
adapter. Android registers the plugin in `MainActivity`; iOS registers an
explicit plugin instance in `AppBridgeViewController`, matching the app's
first-party Capacitor ownership boundary. Formatter tests prove known records
format consistently and unknown values do not reach OS logging. The iOS bridge
integration test proves the compiled plugin is actually callable, while the
TypeScript contract test proves optional diagnostic context is not forwarded.

Logging is best effort and performs no storage or network work. One short line
is emitted per measured phase, so diagnostics do not add work proportional to
the number of projects, landmarks, GPS tracks, map sources, or tiles.
