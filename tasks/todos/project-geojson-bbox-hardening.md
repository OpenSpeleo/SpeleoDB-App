# Project GeoJSON Bounding-Box Validation and Quarantine

## Goal

Validate each project GeoJSON file before it can be displayed or used for map
prefetch. Persist a per-commit quarantine for oversized, invalid, or slow files,
warn the user, and automatically retry only when the project commit changes.

## Corrective Plan

- [x] Add centralized validation constants, types, a pure analyzer, and a
      dedicated Web Worker with a hard 500 ms deadline.
- [x] Extend the project GeoJSON cache entry with typed active/quarantined
      metadata and per-commit warning acknowledgement.
- [x] Audit legacy cached files, including offline startup, and refactor project
      sync to validate before caching or prefetching.
- [x] Emit structured device-console diagnostics for every known project bbox.
- [x] Change tile prefetch and Dashboard map fitting to consume validated cached
      bounds instead of rescanning GeoJSON.
- [x] Cancel queued/persisted tile-prefetch work when a file is quarantined.
- [x] Add the aggregated project-map-data warning modal and global modal
      arbitration.
- [x] Add focused and persistence-level regression tests for analysis, timeout,
      cache, sync, tile prefetch, Dashboard, and warning UI behavior.
- [x] Document intent, architecture, performance, recovery, and verification.
- [x] Run focused tests, the full covered suite, lint, production build, hooks,
      diff checks, and native build checks where available.

## Locked decisions

- A file is faulty when either unpadded bbox dimension is strictly greater than
  100 km; exactly 100 km is accepted.
- Analysis runs in a dedicated worker and must finish before the 500 ms
  deadline.
- `latest_commit.id` identifies the file version. A newer commit is eligible for
  validation and automatic recovery.
- Diagnostics remain on the device console and are not sent to Sentry.
- Quarantine affects the survey GeoJSON only; the project API record remains
  intact.

## Review

### Adversarial audit baseline

The previous Review was removed because it claimed guarantees the tests did not
prove. The corrective review found unsafe cache metadata parsing, non-atomic
acknowledgement, stale post-abort publication, incomplete worker deadlines,
unversioned legacy ambiguity, tile-target removal races, stale Dashboard commit
state, non-exclusive startup modals, a dismissible safety warning, and broad
test/documentation overclaims.

### Final result

The corrective implementation preserves the v3 IndexedDB database, the server
`Project` model, `exclude_geojson`, commit identity, tile zoom/padding, and the
strict raw 100 km policy. Validation metadata is independently schema-v2 and
strictly parsed. Durable quarantine accepts only file-scoped reasons;
infrastructure failures remain typed session dispositions. Active map data is
published atomically as `{ commitId, featureCollection, bounds }` and every
Dashboard consumer requires the commit to match `latest_commit.id`.

The worker deadline now includes construction, structured cloning/posting, and
response receipt. Every response is runtime-validated, terminal paths suppress
global worker errors and release all resources, and failures retain whatever
diagnostics were actually measured. Circular-longitude math is shared by the
analyzer, Dashboard, and tile planner. Raw haversine dimensions retain strict
`> 100 km` rejection while the 100.12 km projected-footprint limit rejects polar
Web-Mercator amplification without rejecting an exact equatorial 100 km fixture.

Persistence writes are abort-aware, warning acknowledgement is one
commit-conditional transaction, project-record read failure is no longer
misreported as a miss, and unversioned legacy bytes remain fail-closed.
Cancellation is rechecked after persistence and prefetch removal before any
counter, warning, log, or revision publication. Session dispositions prevent
repeat storage/download/analysis work and warning reconciliation removes stale
project/commit state. Counter overlap is documented and directly tested.

Tile target removal now uses monotonic generations, generation-bound ownership,
serialized persistence, abortable retry waits, and target-wide cross-layer
deletion. Shared queued/in-flight URLs retain their other owners; solely-owned
active requests abort; cached tile payloads remain. During verification, the new
planner tests found and fixed an additional floating-point defect where a
negative-longitude point could be interpreted as a 359.999-degree interval and
schedule a whole tile row.

Dashboard separates persisted visibility intent from map-data availability,
hides old commits synchronously, ignores stale async loads, and reloads through
the stable controller/context `mapDataRevision`. Directed intervals are merged
as arcs and display latitude is clamped. Startup UI now exposes one modal slot
in offline/auth, companion, GeoJSON warning, storage-consent order. The warning
has reason-specific accessible copy, busy/error states, and refuses backdrop,
back/escape, gesture, and uncontrolled dismissal.

### Automated verification

- `npm run test.unit -- --run --reporter=verbose --coverage --no-file-parallelism`
  passed: 80 files and 1,443 tests.
- Coverage: 84.44% statements (7,005/8,295), 76.54% branches (4,206/5,495),
  87.87% functions (1,572/1,789), and 87.50% lines (6,546/7,481).
- `npm run lint` passed.
- `npm run build` passed: 569 modules transformed and the standalone
  `projectGeoJSONBounds.worker-*.js` asset emitted at 8.28 kB.
- `PREK_HOME=/private/tmp/prek npx prek run -a --show-diff-on-failure` passed
  ESLint, lockfile consistency, TypeScript, and Vite build hooks.
- `npx cap sync android` passed with 13 plugins; `npx cap sync ios` passed with
  12 plugins.
- Android `./gradlew assembleDebug` passed in 4 seconds: 457 actionable tasks
  (26 executed, 431 up-to-date). Gradle reported only the existing flatDir and
  Gradle-10 deprecation warnings.
- Unsigned generic-device iOS Debug `xcodebuild` passed for arm64 with
  `CODE_SIGNING_ALLOWED=NO` and ended with `** BUILD SUCCEEDED **`.
- `git diff --check` and `git diff --cached --check` passed.
- `rg -n 'app-btn[^\"]*bg-' src --glob '*.tsx'` returned no matches.

The authoritative regression coverage includes real fake-IndexedDB transactions,
restart/recovery lifecycle, worker timing and cleanup races, shared-owner tile
queue/removal seams, three-project controller concurrency, cancellation/counter
outcomes, commit-gated Dashboard transitions, modal priority/dismissal, and
acknowledgement persistence failure. The reusable testing rule is recorded in
`tasks/lessons/authoritative-seam-tests.md`.

### Residual risk and physical-device verification

Native synchronization and compilation prove that the worker and web assets
package into both platform projects; they do not prove runtime WebView or device
storage/network behavior. Before release, complete the Android and iOS device
matrix from `docs/project-geojson-validation.md`: worker loading and UI
responsiveness under timeout, structured device-console output, every warning
reason and native dismissal path, map/panel/depth/overlay exclusion, absence of
project tile traffic after removal, shared-request continuity, force-quit and
offline-start persistence, IndexedDB acknowledgement, and automatic recovery
when the server publishes a newer valid commit.
