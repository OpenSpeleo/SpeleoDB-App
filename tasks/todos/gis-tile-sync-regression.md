# Restore standardized tile sync after GIS integration

## Scope and plan

The user reports `Tiles Synced: 0/0` and `Sync Progress: 0%` after the GIS
Geometry change. Trace and fix the real scheduling failure through the shared
DownloadArea catalog, canonical union planner, downloader and progress store.
Preserve saved coverage and source ownership; do not convert failed reads into
authoritative empty collections or add a separate GIS tile pipeline.

- [x] Compare source collection, lifecycle, reconciliation and progress with the
      pre-GIS implementation; reproduce the regression at the owning seam.
- [x] Review GIS metadata/detail availability, revocation and retry behavior
      alongside healthy projects, points, tracks and manual areas.
- [x] Implement the smallest standardized reconciliation/scheduling correction.
- [x] Prove initial nonzero tile planning, preservation of unresolved saved
      sources, recovery, revocation and shared union/layer behavior.
- [x] Update architecture documentation and capture the reusable failure rule.
- [x] Complete independent review, focused and full coverage tests, browser
      checks, lint/type/build and `prek`.

## Ownership

Primary owns TileCoordinator, integration, documentation and final verification.
Independent specialists review the catalog/engine pipeline and façade/GIS
lifecycle; production edits are assigned explicitly after findings agree.

## Review

### Root causes and correction

Compared the GIS feature commit `86ae50d` with its parent `65d4b55`. The GIS
source getter was added to a global source barrier: any metadata/detail failure
prevented all area intent reaching the planner, leaving a fresh catalog at 0/0.
Its failed metadata latch also prevented explicit tile-refresh recovery.
Revocation superseded the whole tile collection, cancelling unrelated work. An
existing test incorrectly required the global freeze.

The standardized DownloadArea catalog, rectangle adapter, canonical union,
worker planner and downloader remain the only tile pipeline. Reconciliation now
accepts authority per automatic source type, preserving unresolved saved rows
and updating healthy ones. GIS supports per-identity retention and checks
freshness inside the catalog transaction. Revocation removes only its own rows.
Explicit tile refresh retries metadata. Legacy pins survive until every source
is authoritative and the replacement completes. No persisted schema changed.

The independent review found a further latency issue: a bounded queue of GIS
requests could still delay the first plan. The reviewed correction publishes
ready core sources while GIS is pending, then merges GIS through the same
service, with at most two publications. Deterministic tests assert nonzero
healthy tile planning before releasing either metadata or detail requests. The
reviewer rechecked cancellation, supersession, revocation, layer preferences and
legacy-pin handling and reported no remaining actionable findings.

The reusable prevention rule is in
[rolling replacement input completeness](../lessons/rolling-replacement-input-completeness.md).
Architecture docs now distinguish retained intent from unavailable source reads.

### Verification

- `npm run test.unit -- --run src/controllers/GisGeometryCoordinator.test.ts src/controllers/TileCoordinator.test.ts src/services/DownloadAreaService.test.ts src/services/downloadAreaGeometry.test.ts --no-file-parallelism`:
  113 passed.
- `npm run test.unit -- --run src/controllers/SpeleoDBController.test.ts --no-file-parallelism`:
  222 passed. Existing landmark/GPS helper controllers needed explicit
  foreground stop and idle teardown because their background work survived
  individual tests. Fixed the owning fixtures; no logs suppressed, sleeps,
  retries or skipped assertions.
- `npx playwright test tests/browser/gis-geometry.spec.ts`: 14 passed.
- `npm run test:browser`: 88 passed across Chromium/WebKit, zero retries. Uses
  production assets, real workers and IndexedDB; asserts healthy automatic tiles
  finish before held GIS requests resolve, then preserves row identity on merge.
- `make ci`: passed quality inventory, repository lint, TypeScript, all 134 test
  files / 2,240 tests with coverage, and production build. Coverage: statements
  90.98%, branches 83.53%, functions 93.08%, lines 93.16%; no thresholds
  changed. An earlier concurrent attempt stopped at lint when an ephemeral
  Playwright trace file disappeared; this complete run was serialized after
  browser tests.
- `npx prek run -a`: passed after Markdown normalization.
- Independent `$review-agent` re-review: no remaining actionable findings after
  correcting the slow-GIS publication barrier. Docs and lesson updated together.

Detailed command logs are in `/tmp/speleodb-tile-regression-ci.log`,
`/tmp/speleodb-tile-regression-focused.log`,
`/tmp/speleodb-tiles-regression-gis-browser-final.log` and
`/tmp/speleodb-tiles-regression-browser-final.log`. Final hook evidence is in
`/tmp/speleodb-tile-regression-prek-final.log`.

No native code, bridge, dependency or platform project changed. The
authoritative regression is in shared JavaScript source collection and IndexedDB
catalog reconciliation; engine/storage tests and production browser workers
cover it. Native suites were not rerun for this correction. Physical iOS/Android
device verification remains unavailable; no device behavior is claimed from
compilation. Existing user authorization covers this correction and the
requested review, tests, prek and local commit. No push is requested.
