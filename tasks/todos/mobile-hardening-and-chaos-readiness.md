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
| MH-006 | P1 | Hidden Settings/Pending pages remain mounted and can retain effects such as polling. | Closed: keep only Dashboard mounted and unmount inactive non-map pages. |
| MH-007 | P2 | Controller and Dashboard exceed safe review/modularity limits. | Extract behavior-owned modules behind stable contracts. |
| MH-008 | P2 | Coverage has no threshold and branch coverage is 76.54%. | Reach and enforce justified per-file 100% runtime coverage. |
| MH-009 | P2 | README, Make, CI, simulator, PWA, and feature documentation contain stale claims. | Reconcile every document with implementation. |
| MH-010 | P2 | Asset-generation development dependencies contain known advisories. | Remove the vulnerable routine toolchain. |
| MH-011 | P0 | Offline/WebView data is eligible for platform backup and device transfer. | Disable Android backup and exclude protected iOS data directories. |
| MH-012 | P0 | Raw errors, deep links, identifiers, coordinates, and payload-shaped data can reach console/Sentry diagnostics. | Enforce one redacted diagnostic boundary. |
| MH-013 | P0 | Remote cleartext instances and automatic redirects can expose credentials or request bodies. | Require release HTTPS and disable redirects for sensitive requests. |
| MH-014 | P1 | iOS declares background fetch and processing modes without scheduling either kind of work. | Restrict the compiled app configuration to recording-owned background location. |
| MH-015 | P2 | Repeated one-shot coverage runs on the same tree can differ by three covered `TileCacheRepository` branches. | Closed: isolate fake IndexedDB, await complete background transactions, and own the overwrite path directly. |

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
- [x] `[Refactoring] Extract dashboard GPS track actions`
- [x] `[Refactoring] Extract dashboard GPS recording and averaging actions`
- [x] `[Refactoring] Extract dashboard landmark actions`
- [x] `[Refactoring] Extract dashboard project visibility actions`
- [x] `[Refactoring] Extract dashboard map data lifecycle`
- [x] `[Refactoring] Extract dashboard map shell`
- [x] `[Refactoring] Unify dashboard panel state`
- [x] `[Refactoring] Extract dashboard landmark presentation`
- [x] `[Refactoring] Decompose dashboard rendering and interaction state`
- [x] `[Testing] Stabilize deterministic coverage reporting`
- [x] `[Fix] Stop inactive page effects and polling`
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

- Commit: `2097d58` (`[Fix] Restrict iOS background execution to recording`).
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

### Extract dashboard GPS track actions

- Commit: `1a2fd37` (`[Refactoring] Extract dashboard GPS track actions`).
- Verification: Node 22 inventory, lint, typecheck, full one-shot Vitest with
  coverage and live API contracts, production build, both-platform Capacitor
  sync, Android lint/unit/release builds, signed iOS XCTest, and iOS Release
  compilation.
- Result: track visibility, lazy geometry, visible-track GeoJSON, GPX sharing,
  map zoom, and upload/edit/delete action state now live in a focused hook
  behind narrow injected ports. Its direct suite has 100% statement, branch,
  function, and line coverage, and Dashboard's 106 characterization tests stay
  green. Dashboard shrinks from 1,709 to 1,449 lines; the production module is
  428 lines and every function remains below 80 lines. Vitest passes
  1,624/1,624 tests across 95 files with aggregate coverage of 87.86%
  statements, 80.69% branches, 90.67% functions, and 90.32% lines. The
  Dashboard lazy chunk is 150.44 KiB (47.90 KiB gzip), 1.40 KiB larger than the
  prior modular boundary but still far below the starting bundle baseline.
  Capacitor sync introduces no tracked native drift; Android passes 9/9 native
  tests plus lint/APK/AAB builds, and iOS passes 9/9 signed native tests plus
  Release compilation.
- Findings closed: the GPS track-action slice of MH-007. Recording/averaging
  action state, landmark presentation/state, chrome, and panel-state
  unification remain scheduled as independently reviewable splits.

### Extract dashboard GPS recording and averaging actions

- Commit: `308853b` (`[Refactoring] Extract dashboard GPS recording actions`).
- Verification: Node 22 inventory, lint, typecheck, full one-shot Vitest with
  coverage and live API contracts, production build, both-platform Capacitor
  sync, Android lint/unit/release builds, signed iOS XCTest, and iOS Release
  compilation.
- Result: recorder controls, cancellation, Android battery guidance, live-track
  geometry, averaging transitions, and landmark handoff now live in a focused
  hook behind narrow controller, battery, toast, and landmark ports. The shared
  mounted guard removes duplicated async-lifecycle code. Its direct 14-test
  suite has 100% statement, branch, function, and line coverage, and Dashboard's
  106 characterization tests stay green. Dashboard shrinks from 1,449 to 1,308
  lines; the production hook is 307 lines and its largest function is 71 lines.
  Vitest passes 1,638/1,638 tests across 96 files with aggregate coverage of
  88.43% statements, 81.15% branches, 91.58% functions, and 90.81% lines. The
  Dashboard lazy chunk is 152.33 KiB (48.72 KiB gzip), 1.89 KiB larger than the
  prior modular boundary but still far below the starting bundle baseline.
  Capacitor sync introduces no tracked native drift; Android passes 9/9
  first-party native tests plus lint/APK/AAB builds, and iOS passes 9/9 signed
  native tests plus Release compilation.
- Findings closed: the recording/averaging action slice of MH-007. Landmark
  presentation/state, chrome, and panel-state unification remain scheduled as
  independently reviewable splits.

### Extract dashboard landmark actions

- Commit: `dc039ad` (`[Refactoring] Extract dashboard landmark actions`).
- Verification: Node 22 inventory, lint, typecheck, full one-shot Vitest with
  coverage and live API contracts, production build, both-platform Capacitor
  sync, Android lint/unit/release builds, signed iOS XCTest, and iOS Release
  compilation.
- Result: collection visibility/collapse, visible landmark GeoJSON, panel
  locate, create/edit/delete state, collection loading, toasts, mounted async
  guards, and averaged-GPS-point handoff now live in a focused hook behind
  narrow controller, map, panel, and preference ports. Its direct 17-test suite
  has 100% statement, branch, function, and line coverage, and Dashboard's 106
  characterization tests stay green. Dashboard shrinks from 1,308 to 1,073
  lines; the production hook is 466 lines and its largest function is 62 lines.
  Vitest passes 1,655/1,655 tests across 97 files with aggregate coverage of
  88.96% statements, 81.74% branches, 92.18% functions, and 91.13% lines. The
  Dashboard lazy chunk is 154.23 KiB (49.45 KiB gzip), 1.90 KiB larger than the
  prior modular boundary but still far below the starting bundle baseline.
  Capacitor sync introduces no tracked native drift; Android passes 9/9
  first-party native tests plus lint/APK/AAB builds, and iOS passes 9/9 signed
  native tests plus Release compilation.
- Findings closed: the landmark action slice of MH-007. Map-shell state,
  chrome, and panel-state unification remain scheduled as independently
  reviewable splits.

### Extract dashboard project visibility actions

- Commit: `284c83a` (`[Refactoring] Extract dashboard project visibility actions`).
- Verification: Node 22 inventory, lint, typecheck, full one-shot Vitest with
  coverage and live API contracts, production build, both-platform Capacitor
  sync, Android lint/unit/release builds, signed iOS XCTest, and iOS Release
  compilation.
- Result: per-project intent, country visibility and collapse, loaded-data
  derivations, persistence, haptics, bulk actions, and zoom activation now live
  in a focused hook behind narrow preference, scheduler, map, and panel ports.
  Its direct suite has 100% statement, branch, function, and line coverage, and
  Dashboard's 106 characterization tests stay green. Dashboard shrinks from
  1,073 to 934 lines; the production hook is 317 lines and its largest function
  is 61 lines. Vitest passes 1,664/1,664 tests across 98 files with aggregate
  coverage of 89.02% statements, 81.95% branches, 92.31% functions, and 91.18%
  lines. The Dashboard lazy chunk is 156.29 KiB (50.02 KiB gzip), 2.06 KiB
  larger than the prior modular boundary but still far below the starting
  bundle baseline. Capacitor sync introduces no tracked native drift; Android
  passes 9/9 first-party native tests plus lint/APK/AAB builds, and iOS passes
  9/9 signed native tests on iPhone 17 Pro/iOS 26.5 plus Release compilation.
- Findings closed: the project-visibility slice of MH-007. Map-shell state,
  chrome, and panel-state unification remain scheduled as independently
  reviewable splits.

### Extract dashboard map data lifecycle

- Commit: `55904fe` (`[Refactoring] Extract dashboard map data lifecycle`).
- Verification: Node 22 inventory, lint, typecheck, full one-shot Vitest with
  coverage and live API contracts, production build, both-platform Capacitor
  sync, Android lint/unit/release builds, signed iOS XCTest, and iOS Release
  compilation.
- Result: revision-driven project and overlay cache reads, GeoJSON/depth
  normalization, commit gating, atomic publication, stale completion guards,
  landmark grouping, and project-linked overlay filtering now live in a focused
  hook behind a two-method data-source port. Its direct 9-test suite has 100%
  statement, branch, function, and line coverage, and Dashboard's 106
  characterization tests stay green. Dashboard shrinks from 934 to 801 lines;
  the production hook is 221 lines and its largest function is 58 lines.
  Vitest passes 1,673/1,673 tests across 99 files with aggregate coverage of
  89.15% statements, 82.04% branches, 92.35% functions, and 91.22% lines. The
  Dashboard lazy chunk is 157.15 KiB (50.48 KiB gzip), 0.86 KiB larger than the
  prior modular boundary but still far below the starting bundle baseline.
  Capacitor sync introduces no tracked native drift; Android passes 9/9
  first-party native tests plus lint, APK, and AAB builds, and iOS passes 9/9
  signed native tests on iPhone 17 Pro/iOS 26.5 plus Release compilation.
- Findings closed: the map-data lifecycle slice of MH-007. Map-shell state,
  chrome, and panel-state unification remain scheduled as independently
  reviewable splits.

### Extract dashboard map shell

- Commit: `d0bc265` (`[Refactoring] Extract dashboard map shell`).
- Verification: Node 22 inventory, lint, typecheck, focused hook/canvas and
  Dashboard characterization coverage, full one-shot Vitest with coverage and
  live API contracts, production build, both-platform Capacitor sync, Android
  lint/unit/release builds, signed iOS XCTest, and iOS Release compilation.
- Result: cached map-style loading, layer selection, icon registration,
  orientation locking, finite viewport metrics, foreground location, user-map
  flight, map/loading/chrome composition, and location error presentation now
  live behind `DashboardMapCanvas` and an injectable eight-operation hook port.
  The hook and canvas each have 100% statement, branch, function, and line
  coverage; Dashboard's 106 characterization tests remain green. Dashboard
  shrinks from 801 to 584 lines, the canvas is 248 lines, the hook is 183 lines,
  and every production function remains below 80 lines. Vitest passes
  1,681/1,681 tests across 100 files with aggregate coverage of 89.27%
  statements, 82.25% branches, 92.58% functions, and 91.34% lines. The
  Dashboard lazy chunk is 159.65 KiB (51.45 KiB gzip), 2.50 KiB (0.97 KiB
  gzip) above the prior modular boundary but still far below the starting
  bundle baseline. Capacitor sync introduces no tracked native drift; Android
  passes 9/9 first-party native tests plus lint, APK, and AAB builds, and iOS
  passes 9/9 signed native tests on iPhone 17 Pro/iOS 26.5 plus Release
  compilation.
- Findings closed: the map-shell and page-size slices of MH-007. Dashboard is
  now within the 600-line production-module budget; modal composition and
  panel-state unification remain scheduled as independently reviewable splits.

### Unify dashboard panel state

- Commit: `7605d4a` (`[Refactoring] Unify dashboard panel state`).
- Verification: Node 22 inventory, lint, typecheck, focused authenticated-shell,
  tab-bar, shared-state, Dashboard, Settings, and Pending tests, full one-shot
  Vitest with coverage and live API contracts, production build,
  both-platform Capacitor sync, Android lint/unit/release builds, signed iOS
  XCTest, and iOS Release compilation.
- Result: three independent panel booleans and three coupled setters are
  replaced by one `DashboardPanel` union and one transition callback across all
  authenticated routes. Impossible multi-panel states are no longer
  representable, and switching panels publishes one atomic React update. The
  authoritative hidden-route test proves the complete none-to-projects-to-
  landmarks-to-GPS-to-none sequence; 191 focused shell/page tests pass.
  Dashboard shrinks from 584 to 576 lines and remains within the
  production-module budget. Vitest passes
  1,684/1,684 tests across 100 files with aggregate coverage of 89.34%
  statements, 82.28% branches, 92.78% functions, and 91.43% lines. The
  Dashboard lazy chunk drops to 159.50 KiB (51.42 KiB gzip), 0.15 KiB (0.03
  KiB gzip) below the prior modular boundary. Capacitor sync introduces no
  tracked native drift; Android passes 9/9 first-party native tests plus lint,
  APK, and AAB builds, and iOS passes 9/9 signed native tests on iPhone 17
  Pro/iOS 26.5 plus Release compilation.
- Findings closed: the panel-state slice of MH-007. Modal composition remains
  scheduled as the final independently reviewable Dashboard split.

### Extract dashboard landmark presentation

- Commit: `623934e` (`[Refactoring] Extract dashboard landmark presentation`).
- Verification: Node 22 inventory, lint, typecheck, focused presentation and
  Dashboard characterization coverage, full one-shot Vitest with coverage and
  live API contracts, production build, both-platform Capacitor sync, Android
  lint/unit/release builds, signed iOS XCTest, and iOS Release compilation.
- Result: marker details, landmark form, destructive confirmation, toast, and
  long-press ring composition now live in two side-effect-free presentation
  components while `useDashboardLandmarkActions` retains state and mutation
  ownership. Splitting dialogs from transient feedback preserves the existing
  GPS-dialog stacking order. The direct 3-test suite and Dashboard's 106
  characterization tests pass; the presentation module has 100% statement,
  branch, function, and line coverage. Dashboard shrinks from 576 to 535 lines,
  the presentation module is 144 lines, and every new function remains below
  80 lines. Vitest passes 1,687/1,687 tests across 101 files with aggregate
  coverage of 89.35% statements, at least 82.28% branches, 92.79% functions,
  and 91.44% lines. Repeated exact-tree runs report 82.28-82.33% branches;
  MH-015 tracks that evidence variance before thresholds are enabled. The
  Dashboard lazy chunk is 160.23 KiB (51.08 KiB gzip): 0.73 KiB
  larger uncompressed but 0.34 KiB smaller compressed than the prior modular
  boundary, and still far below the starting bundle baseline. Capacitor sync
  introduces no tracked native drift; Android passes 9/9 first-party native
  tests plus lint, APK, and AAB builds, and iOS passes 9/9 signed native tests
  on iPhone 17 Pro/iOS 26.5 plus Release compilation.
- Findings closed: the final Dashboard presentation slice of MH-007 and the
  planned Dashboard rendering/interaction decomposition. Domain actions, map
  data, visibility, interactions, layers, map shell, GPS presentation,
  landmark presentation, and mutually exclusive panel state now have focused
  owners.

### Stabilize deterministic coverage reporting

- Commit: `70ac87f` (`[Testing] Stabilize deterministic coverage reporting`).
- Reproduction: repeated serial coverage on the same tree reported either
  90/105 or 93/105 covered branches in `TileCacheRepository`; shuffled seed 1
  reproduced an intermediate 92/105 result. The varying branches were the
  existing-tile paths in `upsertTile`, reached only when an earlier test's
  background write continued into a later test.
- Root cause: the existing-pinned-tile replacement path had no direct owning
  test and was reached only incidentally when background tile work happened to
  overwrite a cached value before coverage collection. Runtime tile/style tests
  also returned after the payload became readable even though metadata and
  cache-stat writes in the same transaction were still pending. Finally,
  fake IndexedDB's auto-installed module singleton did not provide an explicit
  per-file database boundary for serialized workers.
- Correction: service tests now wait for the metadata record and stats update,
  the offline cache-hit test waits for the asynchronous access-time write, and
  each test file receives a fresh fake IndexedDB factory while retaining normal
  persistence within the file. A direct repository regression test now proves
  that replacing an already-pinned tile updates bytes without double-counting
  the tile or dropping its pin. These are the final durable effects and
  isolation boundary owned by the production transaction tests, and the
  previously incidental overwrite branches are now exercised intentionally.
- Verification: the repository regression passes 9/9 tests. The focused
  tile-cache/controller suites pass 215/215 tests under shuffled seeds 1 and
  42; both report exactly 93/105 covered `TileCacheRepository` branches despite
  different test orders. Two consecutive complete one-shot runs pass
  1,688/1,688 tests and report the identical 4,620/5,611 aggregate branches
  (82.33%), including the same 93/105 repository branches. Static/build and
  exact staged evidence are recorded before commit; no native gate applies to
  this test-only/documentation objective.
- Findings closed: MH-015.

### Stop inactive page effects and polling

- Commit: recorded in the next objective after this commit is created.
- Correction: `AuthenticatedAppShell` keeps Dashboard mounted so MapLibre and
  map interaction state survive tab switches, but mounts Settings and Pending
  only for their active routes. Settings no longer reads router state to suspend
  polling; its cache-stat interval is owned by the component lifetime and is
  always cleaned up on unmount. Non-map dialogs, reconnect state, memoized queue
  views, and other page-local effects are released at the same boundary.
- Verification: the shell, Settings, and Pending suites pass 65/65 focused
  tests. Shell characterization proves Dashboard state survives both non-map
  routes, Settings and Pending each unmount when inactive, and the shell module
  has 100% branch and line coverage. Settings' authoritative timer test proves
  immediate refresh, one three-second poll, and no calls after unmount. The full
  suite passes 1,689/1,689 tests with 89.35% statements, 82.35% branches,
  92.79% functions, and 91.43% lines. Dashboard remains 160.23 KiB (51.08 KiB
  gzip); the authenticated shell drops from 2.47 KiB to 2.35 KiB while Settings
  drops from 12.11 KiB to 12.05 KiB. Capacitor sync produces no tracked native
  drift; Android passes 9/9 first-party tests plus lint, APK, and AAB builds,
  and iOS passes 9/9 signed tests on iPhone 17 Pro/iOS 26.5 plus Release
  compilation. Exact staged evidence is recorded before commit.
- Findings closed: MH-006.
