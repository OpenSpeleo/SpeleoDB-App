# Project sync phase timing

## Objective

Make a slow Settings sync diagnosable from the device console by emitting one
structured timing record as each coordinator-owned phase finishes, plus one
terminal record for the whole run. The diagnostic must distinguish the project
refresh from the post-refresh GeoJSON, overlay, GPS, and offline-map scheduling
work without logging user data.

## Design constraints

- Instrument the authoritative `ProjectSyncCoordinator` boundary so UI and
  background callers observe the same phase definitions.
- Use a monotonic clock for elapsed durations; keep the wall-clock
  `lastSyncedAt` contract unchanged.
- Include the sync run ID, phase, duration, status, and reason where one exists.
- Record skipped, failed, aborted, and superseded work as well as successful
  work, and emit exactly one terminal record per run.
- Never log credentials, server URLs, project identifiers/names, response
  payloads, or cached data.
- Add only constant work and a bounded number of console records per sync run.

## TDD checklist

- [x] Add a public-facade regression test for ordered per-phase and total timing
      records using a deterministic monotonic clock.
- [x] Add regression evidence that overlapping syncs retain distinct run IDs and
      that the superseded run receives an aborted terminal record.
- [x] Run the focused tests and record the expected red result.
- [x] Add coordinator-owned timing measurement and structured console output.
- [x] Document the log schema, phase boundaries, privacy boundary, and how to
      interpret slow offline-map scheduling.
- [x] Rerun focused tests and record the green result.
- [x] Run lint, typecheck, build, the complete CI test suite, quality inventory,
      button/MapLibre hard-rule checks, and `git diff --check`.
- [x] Inspect explicit staged and unstaged diffs.
- [x] Commit as `[Feature] Log project sync phase timings` without pushing.
- [x] Inspect the commit and confirm no unintended worktree changes.

## Review

### TDD evidence

- Red coordinator seam:
  `npm run test.unit -- --run src/controllers/SpeleoDBController.test.ts -t "logs ordered phase timings|aborts an older sync run"`
  failed both selected tests because zero `[project-sync:timing]` records
  existed.
- Red offline-map seam:
  `npm run test.unit -- --run src/controllers/TileCoordinator.test.ts -t "logs source collection and plan scheduling"`
  failed because zero `[offline-map:timing]` records existed.
- Green timing seams: the combined command selecting those three regressions
  passed all 3 tests.
- Authoritative controller/coordinator suites:
  `npm run test.unit -- --run src/controllers/TileCoordinator.test.ts src/controllers/SpeleoDBController.test.ts`
  passed all 204 tests after timing bookkeeping was changed to preserve the
  original await topology.
- A later system-loaded run timed out in the unrelated real-IndexedDB GPS
  recovery test during a slow test environment startup. Its isolated rerun
  passed (test body 446 ms). No retry, timeout, or assertion was added.

### Verification

- `npm run lint` — pass.
- `npm run typecheck` — pass.
- `npm run build` — pass; 610 modules transformed and production assets built.
- `npm run quality:inventory` — pass; all 581 tracked files classified.
- Button hard-rule scan (`app-btn[^\"]*bg-`) — pass with no matches.
- MapLibre source rule — not behaviorally exercised by this controller-only
  change; the complete test run retained all existing map contract coverage.
- `git diff --check` — pass.
- `API_TEST_ENABLED=false npm run test:ci` — all 1,897 executed product tests
  passed; the command was non-green solely because the PWA metadata test's
  console guard rejected Rolldown's nondeterministic `PLUGIN_TIMINGS` warning
  from its in-process Vite build. A sequential rerun produced the identical
  harness-only warning. This task does not suppress or weaken an unrelated
  release test diagnostic.
- Native/device runtime — not required for the TypeScript-only diagnostic
  behavior. The production web bundle compiled; actual device-console capture is
  intentionally left for the reported 60-project dataset.

### Design and correction

The coordinator emits bounded structured records for every admitted project sync
phase and one terminal record. Offline-map admission adds source-collection and
plan-scheduling subphase records. Logs contain no credentials, instance URLs,
project identity, or payload data. The first implementation used a generic async
measurement wrapper; existing cancellation/concurrency tests proved that its
extra promise settlement changed scheduling. The final design uses synchronous
timing bookkeeping around the original awaits. The reusable rule is recorded in
`tasks/lessons/instrumentation-async-boundaries.md`.

Concurrent user changes in `src/pages/Settings.tsx`,
`src/pages/Settings.test.tsx`, and
`tasks/todos/pending-logout-single-confirmation.md` are explicitly excluded from
this task's staging and commit.
