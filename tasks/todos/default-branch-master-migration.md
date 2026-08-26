# Default Branch Migration to `master`

## Goal

Align repository-owned automation, guidance, and historical records with
`master` as the default branch without changing unrelated platform/API uses of
the word "main" or branch names owned by upstream repositories.

## Scope boundaries

- [x] Preserve the user's staged workflow and documentation edits.
- [x] Inventory tracked and hidden repository files, excluding generated and
      dependency output.
- [x] Classify Android source-set paths, `src/main.tsx`, Swift main-thread APIs,
      `Main.storyboard`, fixture prose, and the upstream device-model URL as
      non-branch uses that must remain unchanged.
- [x] Confirm the local branch is already named `master`.

## Implementation

- [x] Update every remaining repository-owned default-branch reference.
- [x] Add an automated contract test at the CI workflow seam for the push filter
      and default-branch concurrency behavior.
- [x] Keep the migration limited to branch metadata, documentation, and its
      regression test.

## Verification gates

- [x] Re-run the exhaustive case-insensitive inventory and review every
      remaining match as a protected non-branch use.
- [x] Parse the GitHub Actions workflow and run the focused CI contract test.
- [x] Run lint, type checking, production build, and the complete test suite
      with coverage.
- [x] Run repository pre-commit checks and inspect staged and unstaged diffs.
- [x] Confirm no dependency, generated-native, or unrelated user-owned changes
      were introduced.

## Review

- Updated the GitHub Actions push filter and default-branch concurrency
  exception to `master`, then aligned repository guidance, CI documentation, and
  historical task records.
- The exact-word inventory leaves only protected platform/runtime/prose uses and
  the upstream device-model URL; no repository-owned default-branch reference
  remains under the former name.
- Verification:
  - Workflow YAML parsed with Ruby/Psych: passed.
  - Focused CI contract: 1 file, 2 tests passed.
  - `npm run quality:inventory`: passed for all 611 tracked files.
  - `npm run lint`: passed.
  - `npm run typecheck`: passed.
  - `npm run build`: passed.
  - `API_TEST_ENABLED=false npm run test:ci`: 117 files and 1,926 tests passed;
    2 files and 13 external integration tests skipped. Coverage was 90.39%
    statements, 82.02% branches, 92.95% functions, and 92.54% lines.
  - Task-path `prek` hooks: passed, including YAML validation, Markdown
    formatting, ESLint, type checking, and production build.
- The repository-wide hook run found pre-existing Markdown formatting drift in
  unrelated files. Those formatter-only edits were reverted; the task-path run
  is green and the final diff contains no unrelated files.
- Limitation: changing the hosted repository's default-branch setting, branch
  protection rules, open pull-request targets, and remote symbolic HEAD is an
  external administration step and was not performed by this codebase change.
- Commit: pending.
