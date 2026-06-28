# Mobile Hardening and Chaos Readiness

## Intent

Audit and harden every tracked mobile-app file across TypeScript/React, Android,
iOS, build tooling, CI, static assets, tests, and documentation. The ignored
`SpeleoDB/` backend checkout is out of scope; the mobile app's API boundaries
remain in scope through contract and integration tests.

The work is delivered as independently green commits. Each production change
includes its regression tests and directly affected documentation. Nothing is
pushed by the agent.

## Baseline (2026-06-28)

- Clean `main` with 409 tracked files before this task.
- `npm run lint`: pass.
- `npm run build`: pass.
- Vitest: 80 files and 1,443 tests pass.
- Coverage: 84.44% statements, 76.54% branches, 87.87% functions, 87.50% lines.
- Android `testDebugUnitTest`: pass, but only a generated arithmetic test runs.
- iOS simulator compilation: pass, with no iOS test target.
- No mobile E2E suite exists.
- Runtime npm audit: zero findings. Full development audit: six high and two
  moderate findings rooted in the asset-generation toolchain.
- Bundle with native Sentry path: 378.3 KiB entry, 379.1 KiB initial graph,
  1,083.8 KiB largest lazy chunk.
- Largest production modules: `SpeleoDBController.ts` (3,863 lines) and
  `Dashboard.tsx` (2,967 lines).

## Finding severity

- **P0:** credential exposure, unrecoverable data loss/corruption, invalid
  release artifacts, or a security boundary bypass. Stop other work and fix.
- **P1:** crash, duplicate mutation, stuck state, incorrect durable result,
  broken background behavior, or supported-platform failure. Fix before release.
- **P2:** material performance, accessibility, modularity, test, tooling, or
  documentation defect. Fix within this program.
- **P3:** maintainability improvement with no current behavior or release risk.
  Keep only when it directly supports a completion gate.

Every finding records a reproduction, affected invariant, root cause, fix,
regression test, verification commands, commit, and final disposition.

## Confirmed starting findings

| ID | Severity | Finding | Required disposition |
| --- | --- | --- | --- |
| MH-001 | P0 | Tokens are persisted in WebView `localStorage`. | Migrate atomically to native secure storage. |
| MH-002 | P0 | The documented offline-password path reads a plaintext-password database that is never populated. | Remove it; offline access requires a prior validated session. |
| MH-003 | P0 | Tag CI can publish temporary-signed artifacts as releases. | Separate compile smoke from trusted signed release output. |
| MH-004 | P1 | Native verification is placeholder-only on Android and absent on iOS. | Add real native test targets and device evidence. |
| MH-005 | P1 | There is no cross-platform mobile E2E suite. | Add Appium/WebdriverIO coverage. |
| MH-006 | P1 | Hidden Settings/Pending pages remain mounted and can retain effects such as polling. | Mount or activate effects only for the active page. |
| MH-007 | P2 | Controller and Dashboard exceed safe review/modularity limits. | Extract behavior-owned modules behind stable contracts. |
| MH-008 | P2 | Coverage has no threshold and branch coverage is 76.54%. | Reach and enforce justified per-file 100% runtime coverage. |
| MH-009 | P2 | README, Make, CI, simulator, PWA, and feature documentation contain stale claims. | Reconcile every document with implementation. |
| MH-010 | P2 | Asset-generation development dependencies contain known advisories. | Remove the vulnerable routine toolchain. |

## Commit checklist

- [x] `[Chore] Establish the mobile hardening audit ledger`
- [x] `[Docs] Tighten repository engineering instructions`
- [x] `[Fix] Align local development commands with CI`
- [x] `[Security] Separate compile smoke artifacts from trusted releases`
- [ ] `[Security] Remove the vulnerable asset generation toolchain`
- [ ] `[Feature] Add native secure credential storage`
- [ ] `[Security] Migrate authenticated sessions to secure storage`
- [ ] `[Security] Remove plaintext offline password authentication`
- [ ] `[Security] Harden URLs backups and diagnostics`
- [ ] `[Refactoring] Extract session and startup coordination`
- [ ] `[Refactoring] Extract project synchronization coordination`
- [ ] `[Refactoring] Extract offline mutation and tile coordination`
- [ ] `[Refactoring] Extract GPS recording and track coordination`
- [ ] `[Refactoring] Decompose dashboard rendering and interaction state`
- [ ] `[Fix] Stop inactive page effects and polling`
- [ ] `[Fix] Harden authentication and network state machines`
- [ ] `[Fix] Harden persistence and offline replay`
- [ ] `[Fix] Harden project map and tile processing`
- [ ] `[Fix] Harden GPS landmark and lifecycle behavior`
- [ ] `[Testing] Add property and mutation verification`
- [ ] `[Testing] Add Android native verification`
- [ ] `[Testing] Add iOS native verification`
- [ ] `[Testing] Add cross-platform mobile end-to-end coverage`
- [ ] `[Testing] Enforce complete TypeScript coverage`
- [ ] `[Performance] Enforce bundle runtime and resource budgets`
- [ ] `[Performance] Optimize native release and asset builds`
- [ ] `[Testing] Add deterministic chaos verification`
- [ ] `[CI] Enforce the complete mobile quality matrix`
- [ ] `[Docs] Reconcile product architecture and release documentation`
- [ ] `[Chore] Record final hardening evidence`

## Per-commit gate

Before every commit:

1. Inspect `git status` and the unstaged diff for unrelated changes.
2. Run `npm run quality:inventory` and repository static guards.
3. Run `npm run lint`.
4. Run `npm run test.unit -- --run --coverage --no-file-parallelism`.
5. Run `npm run build`.
6. Run affected Android/iOS/native/E2E gates once present.
7. Stage explicit paths only, inspect the staged diff, and run
   `git diff --cached --check`.
8. Commit only a green, independently CI-capable state. Never push.

## Completion gates

- [ ] Every tracked file is classified by `quality/file-classification.json`.
- [ ] No unresolved P0-P2 findings remain.
- [ ] Runtime TypeScript coverage is 100% per file with reviewed non-runtime exclusions only.
- [ ] Custom Android/iOS code has native unit and integration coverage.
- [ ] Critical state machines have no unexplained surviving mutants.
- [ ] No skipped, focused, flaky, retry-dependent, or console-noisy tests remain.
- [ ] No dependency cycles or production clone blocks of 50 tokens/10 lines remain.
- [ ] Production modules/functions meet documented size and complexity budgets.
- [ ] Android API 24/33/36 and current iPhone/iPad automation pass.
- [ ] Physical Android, iOS 15, and latest-iOS evidence is recorded.
- [ ] Documentation matches the shipped architecture and behavior.

## Review

Not complete. For each commit, append the hash, objective, commands run, results,
coverage/performance changes, and finding IDs closed. Final review must include
the full CI result, dependency status, mutation report, bundle/runtime metrics,
and physical-device evidence.

### Establish the audit ledger

- Commit: `88a86f3` (`[Chore] Establish the mobile hardening audit ledger`).
- Verification: `npm run quality:inventory`, `npm run lint`,
  `npm run test.unit -- --run --coverage --no-file-parallelism`, `npm run build`.
- Result: all checks pass; 1,443 tests pass and the baseline coverage is unchanged.
- Findings closed: none; this commit establishes classification and tracking.

### Tighten repository engineering instructions

- Commit: `e889854` (`[Docs] Tighten repository engineering instructions`).
- Verification: `npm run quality:inventory`, `npm run lint`,
  `npm run test.unit -- --run --coverage --no-file-parallelism`, `npm run build`.
- Result: all checks pass; 1,443 tests pass and coverage remains at the baseline.
- Findings closed: none; this commit strengthens repository-wide prevention rules.

### Align local development commands with CI

- Commit: `2045425` (`[Fix] Align local development commands with CI`).
- Verification: clean `npm ci` and `make ci` under Node 22.22.2, simulator
  resolver against CoreSimulator, and Make dry-run/help inspection.
- Result: all checks pass; 1,443 tests pass and both-platform sync resolves to
  `npx cap sync` without a platform restriction.
- Findings closed: stale Node, sync, simulator, Cypress, and dependency-update contracts.

### Separate compile smoke artifacts from trusted releases

- Commit: recorded after commit creation.
- Verification: workflow YAML parse, `make ci` under Node 22.22.2, Android
  `assembleRelease bundleRelease`, and iOS Release simulator build.
- Result: all web and native compile gates pass; 1,443 tests pass.
- Findings closed: MH-003; disposable credentials can no longer publish a GitHub release.
