# GitHub CI Tests and Native Builds

## Goal

Expand GitHub Actions so pull requests and `master` pushes run the repository
hook contract, the full one-shot Vitest suite, the web production build, and
native Android/iOS build verification. Fix the existing CI Vitest wrapper
failure on Node versions that do not support `--no-webstorage`.

## Plan

- [x] Fix `scripts/run-vitest.sh` so it detects the supported Node web-storage
      disable flag instead of unconditionally passing `--no-webstorage`.
- [x] Update `.github/workflows/ci.yml` to add a `prek run -a` gate, full Vitest
      coverage run, web build artifact, and native Android/iOS stages.
- [x] Keep integration tests secrets-gated and native Sentry DSNs safe for PRs
      where secrets are unavailable.
- [x] Document the CI contract in `docs/ci.md` and link it from
      `docs/README.md`.
- [x] Run verification and record the results below.
- [x] Fix follow-up CI failures from Dashboard async map effects and
      hosted-runner password-auth behavior.
- [x] Re-run targeted and full verification for the follow-up fixes.

## Review

- Updated GitHub Actions to run staged `prek`, full Vitest coverage, web build,
  Android build, iOS build, and tag release artifact jobs.
- Fixed `scripts/run-vitest.sh` so Node 22 no longer fails on unsupported
  `--no-webstorage`; the wrapper probes supported Node flags first.
- Added `coverage` to the ESLint ignore list so local lint remains clean after
  generating V8 coverage output.
- Added `docs/ci.md` and linked it from `docs/README.md`.
- Added `tasks/lessons/node-webstorage-vitest-ci.md` for the Node flag
  compatibility correction.
- Fixed the Dashboard quick-tap ring test by waiting for initial Dashboard
  map/overlay effects to settle before fake-timer pointer assertions; added
  `tasks/lessons/dashboard-test-async-settle.md`.
- Fixed the Dashboard long-press release test with the same map-layer settle
  pattern before fake-timer pointer assertions.
- Serialized CI Vitest files with `--no-file-parallelism` to avoid concurrent
  real password-login attempts from GitHub-hosted runners.
- Required `SPELEODB_OAUTH_TOKEN` for integration tests and made GitHub Actions
  password-auth `403` handling validate that token before treating the failure
  as runner-side auth blocking.
- Verification:
  - `bash -n scripts/run-vitest.sh`: passed.
  - Workflow YAML parsed with Ruby/Psych: passed.
  - `git diff --check`: passed.
  - `npm run test.unit -- --run --reporter=verbose --coverage`: passed (53
    files, 952 tests).
  - `npm run test.unit -- --run src/pages/Dashboard.test.tsx --reporter=dot`:
    passed (88 tests).
  - `npm run build`: passed.
  - `npm run lint`: passed.
  - `npm run test.unit -- --run src/pages/Dashboard.test.tsx -t "does not open GPS modal if pointer is released before long press completes" --reporter=verbose`:
    passed.
  - `npm run test.unit -- --run src/tests/SpeleoDBService.integration.test.ts src/tests/SpeleoDBController.integration.test.ts --no-file-parallelism --reporter=verbose`:
    passed (12 integration tests).
  - `npm run test.unit -- --run src/pages/Dashboard.test.tsx --reporter=dot`:
    passed (88 tests).
  - `npm run test.unit -- --run --reporter=verbose --coverage --no-file-parallelism`:
    passed (53 files, 952 tests).
  - `npm run lint`: passed after the follow-up fixes.
  - `git diff --check`: passed after the follow-up fixes.
  - `PREK_HOME=/private/tmp/prek npx prek run -a --show-diff-on-failure` ran the
    hooks; lockfile, TypeScript, and build hooks passed, but the command
    returned non-zero locally because this implementation checkout is dirty and
    `prek` reported the existing diff as hook modifications. No TS/TSX files
    were changed by the hook.
