# Repair failing `make test` suite

## Plan

- [x] Run `make test` unchanged and capture the failing suite, assertion, and
      runtime diagnostics.
- [x] Trace the failure through the production seam and relevant documentation;
      distinguish a product defect from a stale or nondeterministic test.
- [x] Add or refine focused regression evidence, then implement the smallest
      root-cause fix without weakening assertions or hiding failures.
- [x] Run the focused owning suite and mark the repair proven.
- [x] Run lint, typecheck/build validation, `make test`, the complete coverage
      suite, quality inventory, hard-rule scans, and diff hygiene checks.
- [x] Review the final diff for scope and document commands, results,
      limitations, and commit status below.

## Verification gates

- Original failure reproduced with the unmodified checkout.
- Focused regression passes at the production seam that owns the invariant.
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `make test`
- `API_TEST_ENABLED=false npm run test:ci`
- `npm run quality:inventory`
- Button-background and MapLibre source-ownership hard-rule scans.
- `git diff --check` and explicit worktree diff inspection.

## Review

### Root causes and repair

- The dependency update moved MapLibre GL JS from v5 to v6 without migrating its
  removed default export, renamed ESM worker, or ambient style namespace.
  `TileCacheService` therefore could not load. The direct tile suites failed at
  collection, and logout failed through its authoritative persistent tile
  cleanup seam.
- The root test dependency moved to `history` v5 while React Router v5 still
  owns `history` v4. The shell test pushed a different history implementation
  from the one observed by `useLocation`.
- The release workflow contract was stale and rejected the intentional action
  version tags introduced by the dependency update.
- MapLibre remains at v6.6.0 and now uses named ESM exports, the documented Vite
  `?worker&url` entry, and the named `StyleSpecification` type. The standalone
  history dependency and types are aligned to v4.10.1/v4.7.11. The upgraded
  GitHub Actions retain their human-readable version tags, and the stale test
  now protects those exact versions from being rewritten to hashes.

### Evidence

- Original `make test` — failed: 10/119 files and 28/1,883 tests. Five suites
  could not resolve the removed MapLibre CSP worker, the PWA build rejected the
  removed default export, 25 controller tests reached the same logout cleanup
  failure, the authenticated shell could not observe navigation, and the release
  contract rejected a mutable action tag.
- Focused affected-suite command — pass: 8 files, 59 selected tests.
- `npm run lint` — pass.
- `npm run typecheck` — pass.
- `npm run build` — pass: 619 modules transformed; Vite emitted the bundled
  `maplibre-gl-worker` asset.
- `make test` — pass: 119/119 files, 1,939/1,939 tests.
- `API_TEST_ENABLED=false npm run test:ci` — pass: 117 files passed, 2 skipped;
  1,926 tests passed, 13 skipped. Coverage: 90.39% statements, 82.02% branches,
  92.95% functions, and 92.54% lines.
- `npm run quality:inventory` — pass: all 612 tracked files classified.
- Button-background hard-rule scan — no matches. No MapLibre layer/source
  declarations changed; their contract tests pass in the complete suite.
- The official `actions/*` release workflow references retain the exact version
  tags from the dependency update; the focused contract rejects replacing them
  with 40-character SHAs.
- `git diff --check` — pass; final status and diff inspected explicitly.

### Limitations and status

- No native source or generated native project changed, so Android/iOS native
  compilation is not an applicable gate for this TypeScript/dependency/workflow
  repair. The production web build proves worker bundling; physical WebView
  execution remains device evidence rather than an automated claim.
- The correction exposed a durable workflow-ownership rule. `AGENTS.md` now
  prohibits replacing action version tags with hashes, with the reusable lesson
  in `tasks/lessons/github-actions-version-tags.md`.
- No commit was requested or created.

### Correction after review

- The initial repair incorrectly rewrote intentional GitHub Actions version tags
  into commit SHA pins to satisfy a stale quality assertion. That exceeded the
  task scope and reversed part of the user's dependency update.
- Before the unused manual workflow was removed, it was restored exactly to the
  tag references from `d2196a8`; no hash rewrite remains in repository history.
- Post-correction `make test` — pass: 119/119 files, 1,939/1,939 tests.
