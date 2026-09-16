# Adversarial review of uncommitted offline maps work

## Scope and plan

Review all staged/unstaged/untracked work in SpeleoDB-App against HEAD. The
explicitly invoked review-agent skill authorizes corrective work, full tests,
`prek run -a`, and committing everything reviewed. The Ariane Plugin repository
is outside scope.

- [x] Independently review backend planning, catalog/storage, concurrency,
      recovery and compatibility through the principal-engineer review agent.
- [x] Review controller integration, UI, lifecycle and documentation locally.
- [x] Record actionable findings with severity, file/lines, concrete failure and
      minimal fix; review/correct the corrective plans, then implement them.
- [x] Prove corrections at production seams and update relevant documentation.
- [x] Run full coverage tests, browser tests, lint/typecheck/build and
      `prek run -a`; inspect any hook mutations and repeat affected checks.
- [x] Inspect staged and unstaged diffs and stage explicit reviewed paths.
- Commit all reviewed changes and verify the resulting commit/worktree as the
  final operation; report the immutable commit ID in the completion response.

## Ownership and verification

The review agent owns backend services/types and their tests plus its own
backend review plan. The primary owns controllers/UI, documentation,
integration, repository-wide verification and commits. No concurrent edits to
shared files. The pre-review baseline is 2,008 tests and 36 browser checks
passing; this is context, not proof against the new adversarial cases.

## Findings, corrective review and results

Confirmed P2: polar sources produce zero-height rectangles and reject the whole
automatic catalog update. Backend review reproduces this at the service/storage
seam and clamps source latitude before padding.

Confirmed P2: GPS source deletion and standalone refresh only publish UI state;
the download catalog retains obsolete track rectangles until a full sync.
Reviewed corrective plan: use one controller operation wrapper for completed
standalone GPS upload, deletion and list refresh, wired to the existing shared
source queue. Check cancellation before scheduling. A domain-publication
callback was rejected because it can reconcile the intermediate local-removal
state of an upload before its replacement remote list arrives, and collect
incomplete sources during full sync. Full sync and recording completion retain
their existing final scheduling boundaries. Verify local and remote deletion and
standalone list refresh against the controller's persisted area catalog. The
geometry-key contract still prevents tile recalculation for metadata-only
changes. This keeps compound operation completion in the controller and download
ownership in the existing generic service.

Documentation correction: the manual device checklist still claimed manual layer
pins survive a layer disable, contrary to the shared enabled-layer policy.

Physical-device behavior requires device evidence and will not be inferred from
a green browser suite.

## Verification evidence

- Backend: 89 tests across service, geometry, planner, engine and repository;
  see [backend review](offline-review-backend.md).
- GPS regressions failed before correction for local deletion, remote deletion
  and standalone list refresh; `/tmp/offline-review-gps-before.log`.
- `npm run test.unit -- --run src/controllers/SpeleoDBController.test.ts src/controllers/TileCoordinator.test.ts`:
  218 tests passed. Tests also prove retained catalog coverage while upload
  replacement is pending and cancellation of display/preparation reads before
  logout clears the cache. A former single display-request assertion now asserts
  exactly two aborted requests because standalone sync also requests offline
  geometry.
- `npm run lint`, `npm run typecheck`, `npm run build`: passed.
- `npm run test:ci`: 2,017 tests across 122 files passed; statement coverage
  90.41%, branches 82.80%, functions 92.59%, lines 92.54%.
- `npm run test:browser`: 36 Chromium/WebKit tests passed, with zero retries.
  Reviewed the generated WebKit manager screenshot as well.
- First `prek run -a`: all checks passed except the Markdown formatter, which
  rewrote 20 files already in scope. Inspected the changes: Markdown wrapping,
  tables and embedded JSON only; no TypeScript mutations.
- Final `prek run -a`: passed every applicable hook, with no file mutations.
- `git diff --check` and `git diff --cached --check`: passed. All 60 changed
  files belong to the reviewed feature, its corrections, tests and
  documentation.
- Commit subject:
  `Add unified offline map areas and stable shared tile planning`. Resolve this
  review's commit with
  `git log -1 --format='%h %s' -- tasks/todos/offline-uncommitted-review.md`.

The corrections change shared TypeScript geometry and controller completion
boundaries, with no native code, dependencies, platform configuration, or bridge
changes. Native builds/tests from the feature implementation remain documented
in [its review](offline-download-areas.md); they were not rerun for these
corrections. Physical-device lifecycle, storage-pressure and gesture checks
remain release gates and are not claimed as verified by browser tests.
