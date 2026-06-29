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
| MH-011 | P0 | Offline/WebView data is eligible for platform backup and device transfer. | Disable Android backup and exclude protected iOS data directories. |
| MH-012 | P0 | Raw errors, deep links, identifiers, coordinates, and payload-shaped data can reach console/Sentry diagnostics. | Enforce one redacted diagnostic boundary. |
| MH-013 | P0 | Remote cleartext instances and automatic redirects can expose credentials or request bodies. | Require release HTTPS and disable redirects for sensitive requests. |
| MH-014 | P1 | iOS declares background fetch and processing modes without scheduling either kind of work. | Restrict the compiled app configuration to recording-owned background location. |

## Commit checklist

- [x] `[Chore] Establish the mobile hardening audit ledger`
- [x] `[Docs] Tighten repository engineering instructions`
- [x] `[Fix] Align local development commands with CI`
- [x] `[Security] Separate compile smoke artifacts from trusted releases`
- [x] `[Security] Remove the vulnerable asset generation toolchain`
- [x] `[Feature] Add native secure credential storage`
- [x] `[Security] Migrate authenticated sessions to secure storage`
- [x] `[Security] Remove plaintext offline password authentication`
- [x] `[Security] Harden URLs backups and diagnostics`
- [x] `[Fix] Register iOS credential storage with Capacitor 8`
- [x] `[Fix] Restrict iOS background execution to recording`
- [x] `[Refactoring] Extract session and startup coordination`
- [x] `[Refactoring] Extract project synchronization coordination`
- [x] `[Refactoring] Extract offline mutation and tile coordination`
- [x] `[Refactoring] Extract GPS recording coordination`
- [x] `[Refactoring] Extract GPS track coordination`
- [x] `[Refactoring] Extract GPS recording and track coordination`
- [x] `[Refactoring] Extract dashboard map utilities`
- [x] `[Refactoring] Extract dashboard map layers`
- [x] `[Refactoring] Extract dashboard map interactions`
- [x] `[Refactoring] Extract dashboard GPS presentation`
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

- Commit: `bc93f7f` (`[Security] Separate compile smoke artifacts from trusted releases`).
- Verification: workflow YAML parse, `make ci` under Node 22.22.2, Android
  `assembleRelease bundleRelease`, and iOS Release simulator build.
- Result: all web and native compile gates pass; 1,443 tests pass.
- Findings closed: MH-003; disposable credentials can no longer publish a GitHub release.

### Remove the vulnerable asset generation toolchain

- Commit: `bfe2a44` (`[Security] Remove the vulnerable asset generation toolchain`).
- Verification: clean Node 22 install, production/full npm audits, `make ci`,
  Android release compilation, and iOS Release build.
- Result: clean Node 22 install and both audits report zero vulnerabilities;
  all 1,443 tests and web/native release builds pass.
- Findings closed: MH-010; the dependency and self-installing target are removed.

### Add native secure credential storage

- Commit: `071de85` (`[Feature] Add native secure credential storage`).
- Verification: `make ci` under Node 22.22.2; Android `lintDebug`,
  `testDebugUnitTest`, `assembleRelease`, and `bundleRelease`; five hosted
  Keychain XCTests on iPhone 17 Pro/iOS 26.5; and an iOS Release simulator build.
- Result: all web and native gates pass. The new Android suite passes 9/9 and
  the new iOS suite passes 5/5 with no skips or retries.
- Findings closed: none. This establishes the secure native boundary required
  to close MH-001; session migration remains the next objective.

### Migrate authenticated sessions to secure storage

- Commit: `b083ebb` (`[Security] Migrate authenticated sessions to secure storage`).
- Verification: Node 22 inventory, lint, typecheck, full one-shot Vitest with
  coverage and live API contracts, production build, both-platform Capacitor
  sync, Android `lintDebug`/`testDebugUnitTest`/release APK/AAB, five hosted
  Keychain XCTests on iPhone 17 Pro/iOS 26.5, and iOS Release compilation.
- Result: all gates pass. Vitest passes 1,492/1,492 tests across 84 files;
  `SecureSessionStore` has 100% statements/functions/lines and 97.14% branch
  coverage. Android passes 9/9 native tests and iOS passes 5/5 native tests.
- Findings closed: MH-001. Existing plaintext tokens migrate with rollback,
  fresh sessions never write a token to WebView storage, inconsistent state
  fails closed without erasing unrelated preferences, and logout revokes the
  in-process session even when native deletion reports failure. Browser preview
  login remains functional through a deliberately non-persistent memory store.

### Remove plaintext offline password authentication

- Commit: `ea4916a` (`[Security] Remove plaintext offline password authentication`).
- Verification: Node 22 inventory, lint, typecheck, full one-shot Vitest with
  coverage and live API contracts, production build, both-platform Capacitor
  sync, Android lint/unit/release builds, signed iOS Keychain XCTests, and iOS
  Release compilation.
- Result: all gates pass. Vitest passes 1,494/1,494 tests across 84 files;
  Android passes 9/9 native tests and iOS passes 5/5 native tests.
- Findings closed: MH-002. No production path reads or compares a local
  password or creates a synthetic offline token; bootstrap removes legacy
  plaintext residue and offline continuity requires a restored secure session.

### Harden URLs backups and diagnostics

- Commit: `a0ce0da` (`[Security] Harden URLs backups and diagnostics`).
- Verification: Node 22 inventory, lint, typecheck, full one-shot Vitest with
  coverage and live API contracts, production build, both-platform Capacitor
  sync, Android lint/unit/release builds, signed iOS XCTest, and iOS Release
  compilation with processed entitlement and built ATS inspection.
- Result: all gates pass. Vitest passes 1,510/1,510 tests across 86 files;
  Android passes 9/9 native tests and iOS passes 7/7 native tests.
- Findings closed: MH-011, MH-012, and MH-013. Backups/transfers exclude app
  data, release traffic is HTTPS-only, sensitive requests do not redirect, and
  console/Sentry diagnostics receive bounded redacted values only.

### Extract session and startup coordination

- Commit: `66a829d` (`[Refactoring] Extract session and startup coordination`).
- Verification: Node 22 inventory, lint, typecheck, full one-shot Vitest with
  coverage and live API contracts, production build, both-platform Capacitor
  sync, Android lint/unit/release builds, signed iOS XCTest, and iOS Release
  compilation.
- Result: all gates pass. Vitest passes 1,546/1,546 tests across 87 files;
  aggregate coverage is 85.05% statements, 77.24% branches, 88.38% functions,
  and 88.03% lines. Android passes 9/9 native tests and iOS passes 7/7 native
  tests. The new `SessionCoordinator` owns login, restoration, validation
  cancellation, offline lock, explicit reconnect, and logout decisions behind
  narrow ports while `SpeleoDBController` preserves its public façade. Direct
  coordinator coverage is 100% statements, branches, functions, and lines; the
  controller shrinks from 3,863 baseline lines to 3,567 lines without changing
  its characterized behavior.
- Findings closed: the session/startup slice of MH-007. Project, offline/tile,
  GPS, and dashboard ownership remain scheduled in the next objectives.

### Extract project synchronization coordination

- Commit: `66e5281` (`[Refactoring] Extract project synchronization coordination`).
- Verification: Node 22 inventory, lint, typecheck, full one-shot Vitest with
  coverage and live API contracts, production build, both-platform Capacitor
  sync, Android lint/unit/release builds, signed iOS XCTest, and iOS Release
  compilation.
- Result: all gates pass. Vitest passes 1,546/1,546 tests across 87 files;
  aggregate coverage is 85.28% statements, 77.36% branches, 88.72% functions,
  and 88.32% lines. Android passes 9/9 native tests and iOS passes 7/7 native
  tests. Project-list state, cancellation, phase ordering, terminal
  publication, GeoJSON validation/quarantine, and overlay refresh now have
  focused owners behind the unchanged controller façade. Each new module is
  below 600 lines; the controller shrinks from 3,567 to 2,468 lines.
- Findings closed: the project synchronization and GeoJSON/overlay ownership
  slice of MH-007. Tile/offline and GPS ownership remain next.

### Extract offline mutation and tile coordination

- Commit: `0c04f62` (`[Refactoring] Extract offline mutation and tile coordination`).
- Verification: Node 22 inventory, lint, typecheck, full one-shot Vitest with
  coverage and live API contracts, production build, both-platform Capacitor
  sync, Android lint/unit/release builds, signed iOS XCTest, and iOS Release
  compilation.
- Result: all gates pass. Vitest passes 1,546/1,546 tests across 87 files;
  aggregate coverage is 85.25% statements, 77.32% branches, 88.68% functions,
  and 88.32% lines. Android passes 9/9 native tests and iOS passes 7/7 native
  tests. Offline queue lifecycle/revision/replay delegation and tile
  service/consent/layer/scheduling ownership now sit behind focused
  coordinators without changing persisted operation or tile formats. Both new
  modules remain below 600 lines; the controller shrinks from 2,468 to 2,017
  lines.
- Findings closed: the offline mutation and tile ownership slice of MH-007. GPS
  and dashboard ownership remain scheduled next.

### Extract GPS recording coordination

- Commit: `735d07a` (`[Refactoring] Extract GPS recording coordination`).
- Verification: Node 22 inventory, lint, typecheck, full one-shot Vitest with
  coverage and live API contracts, production build, both-platform Capacitor
  sync, Android lint/unit/release builds, signed iOS XCTest, and iOS Release
  compilation.
- Result: all gates pass. Vitest passes 1,556/1,556 tests across 88 files;
  aggregate coverage is 85.40% statements, 77.45% branches, 89.00% functions,
  and 88.39% lines. Android passes 9/9 native tests and iOS passes 7/7 native
  tests. The recording/watch lifecycle now has a focused coordinator behind the
  unchanged controller façade. Its direct suite has 100% statement, branch,
  function, and line coverage; the existing controller suite remains the
  integration characterization boundary. The controller shrinks from 2,017 to
  1,706 lines, and the new production module is 298 lines.
- Findings closed: the recording-state portion of MH-007. Local/remote track,
  GPX, upload, and server-sync ownership remain in the next split objective.

### Extract GPS track coordination

- Commit: `3838b4c` (`[Refactoring] Extract GPS track coordination`).
- Verification: Node 22 inventory, lint, typecheck, full one-shot Vitest with
  coverage and live API contracts, production build, both-platform Capacitor
  sync, Android lint/unit/release builds, signed iOS XCTest, and iOS Release
  compilation.
- Result: local/remote state, persistence serialization, geometry/GPX, optimistic
  snapshots, upload/edit/delete policy, and abort-aware server synchronization
  now live in two focused coordinators behind the unchanged controller façade.
  All gates pass: Vitest passes 1,584/1,584 tests across 90 files with aggregate
  coverage of 86.32% statements, 78.89% branches, 89.47% functions, and 89.00%
  lines; Android passes 9/9 native tests and iOS passes 7/7. Both direct suites
  have 100% statement, branch, function, and line coverage. Production modules
  are 341 and 269 lines; the controller shrinks from 1,706 to 1,237 lines.
- Findings closed: the remaining GPS ownership slice of MH-007. Dashboard
  rendering and interaction ownership is next.

### Extract dashboard map utilities

- Commit: `482f1b7` (`[Refactoring] Extract dashboard map utilities`).
- Verification: Node 22 inventory, lint, typecheck, full one-shot Vitest with
  coverage and live API contracts, production build, both-platform Capacitor
  sync, Android lint/unit/release builds, signed iOS XCTest, and iOS Release
  compilation.
- Result: deterministic overlay normalization/filtering, marker hit testing,
  icon loading, geographic bounds, touch thresholds, and map orientation now
  live in a focused module. Its direct suite has 100% statement, branch,
  function, and line coverage, while the existing Dashboard suite remains the
  rendering characterization boundary. All gates pass: Vitest passes
  1,598/1,598 tests across 91 files with aggregate coverage of 86.64%
  statements, 79.26% branches, 89.62% functions, and 89.23% lines; Android
  passes 9/9 native tests plus lint/APK/AAB builds, and iOS passes 7/7 native
  tests plus Release compilation. Capacitor sync introduces no tracked native
  drift. Dashboard shrinks from 2,967 to 2,665 lines; the production utility is
  299 lines.
- Findings closed: the deterministic map-policy slice of MH-007. Dashboard
  layer rendering, interaction state, GPS presentation, modals, and chrome
  remain scheduled as independently reviewable splits.

### Extract dashboard map layers

- Commit: `0ca8a62` (`[Refactoring] Extract dashboard map layers`).
- Verification: Node 22 inventory, lint, typecheck, full one-shot Vitest with
  coverage and live API contracts, production build, both-platform Capacitor
  sync, Android lint/unit/release builds, signed iOS XCTest, and iOS Release
  compilation.
- Result: project, overlay, saved-track, active-recording, and user-location
  MapLibre declarations now live in three data-in/render-out modules. Their
  combined direct and characterization coverage is 100% for statements,
  branches, functions, and lines. All web gates pass: Vitest passes
  1,601/1,601 tests across 92 files with aggregate coverage of 86.70%
  statements, 79.33% branches, 89.71% functions, and 89.28% lines. Dashboard
  shrinks from 2,665 to 2,166 lines; the production modules are 169, 414, and
  103 lines. Capacitor sync introduces no tracked native drift; Android passes
  9/9 native tests plus lint/APK/AAB builds, and iOS passes 7/7 native tests
  plus Release compilation.
- Findings closed: the declarative map-layer slice of MH-007. Interaction
  orchestration, GPS presentation, modals, chrome, and panel-state unification
  remain scheduled as independently reviewable splits.

### Extract dashboard map interactions

- Commit: `fb14f8d` (`[Refactoring] Extract dashboard map interactions`).
- Verification: Node 22 inventory, lint, typecheck, full one-shot Vitest with
  coverage and live API contracts, production build, both-platform Capacitor
  sync, Android lint/unit/release builds, signed iOS XCTest, and iOS Release
  compilation.
- Result: touch/pen tap, long-press, empty-spot validation, marker selection,
  loading-ring, depth-probe, timer, and cancellation state now live in a focused
  hook. Its direct and Dashboard characterization coverage is 100% for
  statements, branches, functions, and lines. All web gates pass: Vitest passes
  1,608/1,608 tests across 93 files with aggregate coverage of 86.90%
  statements, 79.67% branches, 89.75% functions, and 89.47% lines. Dashboard
  shrinks from 2,166 to 1,860 lines; the production hook is 295 lines.
  Capacitor sync introduces no tracked native drift; Android passes 9/9 native
  tests plus lint/APK/AAB builds, and iOS passes 7/7 native tests plus Release
  compilation.
- Findings closed: the map-interaction slice of MH-007. GPS presentation,
  modals, chrome, and panel-state unification remain scheduled as independently
  reviewable splits.

### Extract dashboard GPS presentation

- Commit: `b7a8599` (`[Refactoring] Extract dashboard GPS presentation`).
- Verification: Node 22 inventory, lint, typecheck, full one-shot Vitest with
  coverage and live API contracts, production build, both-platform Capacitor
  sync, Android lint/unit/release builds, signed iOS XCTest, and iOS Release
  compilation.
- Result: recording/averaging activity composition and upload/delete/edit track
  dialogs now live in two props-in/callbacks-out modules with no controller,
  persistence, network, timer, or lifecycle ownership. Direct and Dashboard
  characterization coverage is 100% for statements, branches, functions, and
  lines. All web gates pass: Vitest passes 1,610/1,610 tests across 94 files
  with aggregate coverage of 86.95% statements, 79.75% branches, 89.88%
  functions, and 89.51% lines. Dashboard shrinks from 1,860 to 1,709 lines;
  the production modules are 56 and 233 lines. Capacitor sync introduces no
  tracked native drift; Android passes 9/9 native tests plus lint/APK/AAB
  builds, and iOS passes 7/7 native tests plus Release compilation.
- Findings closed: the GPS presentation slice of MH-007. GPS action state,
  landmark presentation/state, chrome, and panel-state unification remain
  scheduled as independently reviewable splits.

### Register iOS credential storage with Capacitor 8

- Commit: `e0551b8` (`[Fix] Credentials Secure Storage Interacting with
  Capacitor 8`).
- Verification: full Node 22 web gates, signed iOS XCTest on an iPhone 17 Pro
  simulator, and iOS Debug/Release simulator compilation.
- Result: the first-party `CredentialStore` is registered through Capacitor
  8's live instance-registration path and a bridge integration test proves the
  JavaScript-visible plugin exists. Signed iOS tests pass 8/8. Physical-device
  login remains part of the final device matrix.
- Follow-up: review found unrelated background `fetch` and `processing` modes
  in the same commit; MH-014 is closed by the next isolated objective.

### Restrict iOS background execution to recording

- Commit: recorded in the next objective after this commit is created.
- Verification: Node 22 inventory, lint, typecheck, full one-shot Vitest with
  coverage and live API contracts, production build, both-platform Capacitor
  sync, Android lint/unit/release builds, signed iOS XCTest, and iOS Release
  compilation.
- Result: the compiled iOS app now declares only the `location` background
  mode, matching the sole runtime owner, and a hosted XCTest prevents hidden
  `fetch` or `processing` declarations from returning. All web gates pass:
  Vitest passes 1,610/1,610 tests across 94 files with aggregate coverage of
  86.95% statements, 79.70% branches, 89.88% functions, and 89.51% lines.
  Capacitor sync introduces no tracked native drift; Android passes 9/9 native
  tests plus lint/APK/AAB builds, and iOS passes 9/9 signed native tests plus
  Release compilation.
- Findings closed: MH-014.
