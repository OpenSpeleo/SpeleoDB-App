# July 2026 Release Readiness Audit and Remediation

## Goal

Audit the complete SpeleoDB mobile repository before the next release, including
all 62 commits after `d556d2356915bb510a1fc0764a6d020d1718279d`, then correct
every confirmed release-relevant defect with test-driven development:

1. add an assertion at the production seam that owns the invariant;
2. run it and record the expected red result;
3. implement the smallest root-cause correction;
4. rerun the focused test and record the green result;
5. run the applicable integration, full-suite, native, and device gates.

The ignored backend checkout is out of scope. Its HTTP contracts remain in scope
through service/controller tests and the configured staging integration tests.
No release, tag, push, store submission, or credential change is authorized by
this task.

## Commit discipline

Each RR item is an independent, green delivery unit. For every item: add and run
the red regression test, implement the root-cause fix, run the focused and
applicable repository gates, update its documentation/review evidence, inspect
staged and unstaged changes, commit explicit paths, and verify the resulting
commit and worktree before beginning the next RR item. Red tests are evidence,
not standalone failing commits.

Commit subjects use `[Type] Message`. The planned sequence is:

1. `[Docs] Add July 2026 release readiness plan`
2. `[Fix] Make logout cache cleanup failure independent` — RR-001
3. `[Fix] Cancel user operations during logout` — RR-002
4. `[Feature] Warn before discarding pending offline operations` — RR-014
5. `[Fix] Make confirmed cache mutations atomic` — RR-003
6. `[Fix] Serialize offline operation replay` — RR-004
7. `[Fix] Make offline operation replacement atomic` — RR-005
8. `[Fix] Report GPS persistence failures` — RR-006
9. `[Fix] Serialize GPS recording transitions` — RR-007
10. `[Test] Enforce audited coverage thresholds` — RR-010
11. `[Fix] Correct SpeleoDB PWA metadata` — RR-011
12. `[Docs] Align release documentation with runtime behavior` — RR-012
13. `[Docs] Define trusted release ceremony` — RR-009
14. `[Chore] Audit Gradle deprecation warnings` — RR-013
15. `[Docs] Record release remediation results`

No commit may combine RR items. Corrections discovered before advancing remain
associated with the current RR in a separate `[Fix]` commit. Do not amend,
squash, rebase, push, open a PR, tag, publish, or submit an artifact.

## Severity model

- **P0 — release blocker:** privacy/security boundary violation, post-logout
  data resurrection, unrecoverable user-data loss/corruption, or an invalid
  release artifact.
- **P1 — release blocker:** duplicate remote mutation, false durable-success
  claim, native lifecycle race, stuck/crashing user flow, or a missing test gate
  for a critical supported-platform behavior.
- **P2 — release hardening:** material test, metadata, documentation,
  performance, or maintainability defect that should be resolved in this release
  program but does not itself expose or destroy user data.
- **P3 — follow-up:** low-risk ecosystem/tooling debt with no demonstrated
  current product failure.

## Audit scope and evidence

- [x] Read `AGENTS.md`, `docs/coding-rules.md`, architecture guidance, the
      complete lessons inventory, and the prior hardening/offline-map ledgers.
- [x] Classify all 557 tracked files and inspect the production/test/native
      inventory.
- [x] Review the 62-commit range after `d556d235...`, with detailed attention to
      session hardening, controller extraction, offline-map replacement, GeoJSON
      validation, MapLibre composition, GPS/live heading, CI, and the final
      dependency updates.
- [x] Inspect current auth/session, networking, cache/persistence, offline
      mutation, offline-map, GPS recording/track, dashboard/map, monitoring,
      PWA, Android, iOS, build, and release-documentation seams.
- [x] Mechanically verify the hard button and MapLibre source-ownership rules.
- [x] Establish the web, staging API, dependency, and Android baseline.
- [x] Complete the iOS XCTest baseline and record its result.
- [ ] Obtain the physical-device evidence listed below; compilation and
      simulator success do not substitute for it.

## Severity-ordered findings

### P0 — release blockers

#### RR-001 — Logout does not attempt every user-data store after one clear failure

`ProjectCacheService.clearAll()` awaits `projects`, `geojson`, `offline_ops`,
and `gps_tracks` sequentially. A rejection from an early store prevents every
later clear from being attempted. `SpeleoDBController.purgeAllLocalUserData()`
wraps this as only one `Promise.allSettled` item, so its otherwise careful
cleanup fan-out cannot repair the skipped stores. Pending mutations and precise
recorded locations can therefore remain on disk after logout and become visible
to a later session because these caches are not account-namespaced.

Owning seams: `ProjectCacheService.clearAll()` and controller logout.

- [x] **RED:** add a `ProjectCacheService` test whose first/second store clear
      rejects and assert all four store clears were attempted; add a controller
      integration test proving retained GPS/offline records are not observable
      after a failed-but-completed logout cleanup attempt.
- [x] Run the focused tests and record the expected skipped-clear failures.
- [x] **GREEN:** make the four cache-store clears independent, await all of
      them, and throw one fixed aggregate cleanup failure only after every store
      has settled. Preserve abort authority.
- [x] Rerun the focused tests and the existing destructive-logout matrix.

#### RR-002 — User mutations and offline replay can repopulate data after logout

Controller invalidation cancels session, project-sync, and tile work, but does
not own landmark CRUD, GPS upload/edit/delete, lazy user-data reads, or
`OfflineOpQueue` replay. These operations are not tracked by
`waitForTrackedOperations()` and their service calls do not receive the logout
abort signal. A request admitted before logout can settle afterward, publish a
revision, or write user data into the freshly cleared cache. An old queue object
also remains live after `OfflineMutationCoordinator.reset()`.

Owning seams: controller user-operation lifetime, mutation coordinators, offline
replay port, and service request `AbortSignal` forwarding.

- [x] **RED:** add deferred controller tests for in-flight landmark create,
      landmark/GPS edit/delete, collection/geometry load, and offline replay.
      Start each operation, begin logout, settle the ignored transport after
      teardown, and assert: transport sees abort, logout waits for admitted
      work, no cache write occurs, no revision publishes, no op is removed, and
      no old-session data reappears.
- [x] Run the focused tests and record every stale publication/write.
- [x] **GREEN:** create one controller-owned cancellable user-operation
      lifetime, track admitted mutations/replays, pass its signal through every
      service wrapper and replay port, recheck authority after each awaited
      persistence boundary, and abort/reset it during logout before cache
      deletion.
- [x] Rerun the focused tests, auth/logout suites, and real staging auth tests.

### P1 — release blockers

#### RR-014 — Voluntary logout does not require explicit consent to lose pending operations

The Settings sign-out modal says local data is cleared, but it does not identify
pending offline operations, show their count, or require an explicit
acknowledgement that they will be permanently and irrecoverably deleted. Forced
logout after invalid credentials must remain non-interactive so security cleanup
cannot be blocked by UI.

Owning seam: the voluntary Settings sign-out confirmation using the existing
live `pendingOpsCount` context value.

- [x] **RED:** add Settings tests for zero, one, and multiple pending
      operations; assert the current modal lacks the conditional warning and
      required acknowledgement and permits destructive sign-out without
      agreement.
- [x] **GREEN:** when the count is positive, show “Pending offline operations
      will be lost,” the exact singular/plural count, and the statement that the
      operations cannot be recovered or synchronized later. Require the user to
      check “I understand that these pending offline operations will be
      permanently deleted and are unrecoverable” before enabling sign-out.
- [x] Reset acknowledgement when the modal closes or the count changes. Preserve
      it for an in-place retry only when the count is unchanged. Disable
      dismissal and duplicate actions while logout runs.
- [x] Prove zero pending operations preserve the existing flow and forced
      unauthorized logout never waits for UI consent.

#### RR-003 — Confirmed mutations can corrupt or silently fail ground-truth cache publication

Landmark and remote-GPS cache updates use separate best-effort read/write calls.
Read errors are converted to `null`/`[]`, so a later successful write can
replace the complete collection with one item (or empty it). Write methods
return `false`, but mutation callers ignore that result, publish success, and
offline replay removes the durable op. Concurrent read/modify/write calls can
also lose one another. The visible marker/track can disappear or revert
immediately even though the server accepted the user's mutation.

Owning seams: `CacheStore.update()`, strict project-cache mutation APIs,
controller landmark apply, and GPS remote apply.

- [x] **RED:** add real fake-IndexedDB transaction tests for concurrent
      upserts/removals, read failure, write abort/failure, and offline-replay
      finalization. Assert unrelated ground truth is preserved and the op is
      retained until the confirmed server result is durably reflected.
- [x] Run the focused tests and record the lost-update/failure-opaque results.
- [x] **GREEN:** replace best-effort split read/write mutation paths with
      strict, atomic single-transaction cache mutations. Only publish revisions
      and remove offline ops after transaction completion. Keep best-effort
      cache APIs only for genuinely optional snapshots.
- [x] For create replay, preflight the freshly pulled server snapshot by stable
      identity before POST so retry after a local commit failure cannot create a
      duplicate remote landmark.
- [x] Rerun cache, controller, offline-queue, and integration suites.

#### RR-004 — Offline replay admits concurrent runs and can duplicate remote mutations

`OfflineOpQueue.syncAll()`, `syncOne()`, and conflict resolution set a boolean
but do not serialize or coalesce callers. Two user actions admitted before the
React busy state rerenders can pull the same snapshot and issue the same POST or
PATCH concurrently. Landmark creation has no client idempotency key, so this can
create duplicate remote landmarks.

- [x] **RED:** defer the replay pull/POST, start two replay commands, and assert
      current code issues two remote mutations for one op.
- [x] **GREEN:** add a queue-owned command lane/single-flight replay contract.
      Define whether compatible callers share a summary or serialize; never
      allow the same op to execute concurrently.
- [x] Rerun mixed-entity, per-op, conflict, network-interruption, and force-quit
      replay tests.

#### RR-005 — Offline-op replacement is neither atomic nor concurrency-safe

Replacing update/delete intent persists the new record and removes the old
record in separate IndexedDB transactions. A failure or process death between
them leaves two durable ops for one subject; the in-memory queue can disagree
with disk. Concurrent enqueues can both observe no existing op and independently
append, violating the documented one-subject/one-op invariant.

- [x] **RED:** add failure-injection and fake-IndexedDB tests for every
      update↔delete replacement boundary plus two simultaneous same-subject
      enqueues; reopen the queue and assert the current duplicate/divergent
      records.
- [x] **GREEN:** serialize queue mutations and add one atomic store transaction
      for replace/remove+put. Update memory only after durable commit.
- [x] Rerun load, coalescing, persistence-error, replay, and force-quit tests.

#### RR-006 — GPS recording reports durable success after storage rejection

`GpsTrackCoordinator.persist()` catches IndexedDB failure and resolves.
`GpsRecordingCoordinator.stop()` then returns a track, the Dashboard says “Track
saved,” and fatal permission loss says captured points “were saved.” A force
quit can lose the accepted track despite the explicit durability contract. Local
delete failures are also hidden while the item is removed from memory, allowing
deleted tracks to reappear after restart.

- [x] **RED:** reject the final/incremental `GpsTrackStore.put()` and local
      delete ports. Assert stop/fatal finalization currently claims success and
      deletion currently disappears only in memory.
- [x] **GREEN:** propagate durable write/delete results at user-command
      boundaries, retain a recoverable in-memory recording on final-save
      failure, and show a fixed actionable UI error. Fatal native callbacks must
      publish “saved” only after persistence completes; otherwise retain and
      surface recovery state without an unhandled rejection.
- [x] Rerun GPS coordinator, recording UI, logout persistence, and force-quit
      recovery tests.

#### RR-007 — GPS recording transitions allow overlapping native commands

`start()` leaves state `idle` while awaiting permissions; `stop()`, `pause()`,
and `resume()` likewise expose their prior state through awaited watcher and
persistence calls. Real repeated taps can therefore admit two starts/stops and
race native watcher ownership or duplicate finalized tracks. The Dashboard also
fires stop/discard/pause/resume promises without complete rejection handling.

- [x] **RED:** use deferred permission, watcher, and persistence ports to invoke
      same-turn and overlapping start/pause/resume/stop/discard commands; assert
      duplicate calls and unhandled UI outcomes.
- [x] **GREEN:** give the recording coordinator synchronous command admission
      and a serialized transition lane, with explicit deterministic semantics
      for redundant/superseding commands. Add UI action ownership and fixed
      error feedback for every async command.
- [x] Rerun recording, Dashboard action, native watcher, and lifecycle suites.

#### RR-009 — Current CI artifacts are compile smoke, not distributable releases

CI intentionally signs Android/iOS tag artifacts with disposable identities.
That correctly proves compilation but not publisher identity, entitlements,
store eligibility, upgrade installation, symbol/mapping retention, or release
artifact reproducibility.

- [x] Document the trusted manual/automated release ceremony: exact version
      bump, protected signing identity, clean install + upgrade install, store
      validation, symbol/mapping retention, artifact hashes, and rollback rule.
- [x] Do not add secrets or publishing permissions without explicit user
      authorization. Record this as an external release gate if trusted signing
      is performed outside the repository.

### P2 — release hardening

#### RR-010 — Coverage is measured but not enforced

The deterministic suite reports 90.02% statements, 82.13% branches, 92.29%
functions, and 92.01% lines. There is no coverage threshold, and the critical
offline queue is only 77.79% statements / 63.12% branches. A regression can
lower coverage while CI remains green.

- [x] Add regression tests from RR-001 through RR-007 at their owning seams.
- [x] Add non-regression global and critical-file thresholds based on the new
      audited baseline; do not game coverage with exclusions or mirror tests.
- [x] Record justified non-runtime exclusions and a staged path toward the
      repository's existing 100%-per-file completion gate.

#### RR-011 — Shipped web/PWA metadata references missing assets and stale product names

`public/manifest.json` references `/icons/icon.svg`, while no such file is
shipped. `index.html` references `/app-icon.png`, also absent from `dist`, and
uses “Ionic App” for the document and Apple home-screen titles. Native app names
are correct, but the web/PWA artifact has 404 icons and stale branding.

- [x] **RED:** add a build-artifact metadata test that resolves every manifest
      and HTML icon path inside `dist` and asserts SpeleoDB titles.
- [x] **GREEN:** ship one reviewed icon source at the referenced public path(s),
      use correct sizes/MIME metadata, and replace stale Ionic titles.
- [x] Build and inspect the rendered manifest/icon responses.

#### RR-012 — Release documentation contradicts current behavior

`GPS_NATIVE_RELEASE_CHECKLIST.md` says reconnect drains pending GPS uploads
automatically, while the canonical queue requires explicit Pending-page replay.
It also says Android notification denial prevents recording, while current code
and `docs/app-permissions.md` deliberately allow recording with the notification
hidden. `docs/deep-linking.md` says the URL itself is logged, while code logs a
fixed event label. These contradictions can produce false release failures or
miss the actual contract.

- [x] Align the native checklist and deep-link docs with code after behavior is
      locked by tests.
- [x] Update logout, offline queue, GPS recording/track, persistence, testing,
      and release docs for every correction above, including performance impact
      and physical-device limits.

### P3 — follow-up debt

#### RR-013 — Android build reports Gradle ecosystem deprecations

The Android matrix passes, but Gradle reports plugin `flatDir` use and features
that will be incompatible with Gradle 10. These warnings currently originate in
the Capacitor/plugin build graph and do not demonstrate a shipped defect.

- [x] Capture `--warning-mode all`, attribute each warning to repository or
      third-party ownership, and schedule only diagnosed compatible changes.
- [x] Do not perform a blanket dependency or Gradle upgrade in this release
      task.

## Implementation order

- [x] Phase 1: RR-001, RR-002, and RR-014 — close logout/cross-session privacy
      and require informed consent for pending-operation loss first.
- [x] Phase 2: RR-003 through RR-005 — make cache and offline intent durable,
      atomic, and single-flight.
- [x] Phase 3: RR-006 and RR-007 — make GPS save and native transitions honest
      and race-safe.
- [x] Phase 4: RR-010 through RR-012 — enforce regression gates and align
      shipped metadata/documentation.
- [x] Phase 5 repository work: RR-009 — define the trusted signing/install/store
      ceremony.
- [ ] Phase 5 external execution: run the supported physical-device checks and
      trusted signing/install/store validation.
- [x] Reassess elegance and duplication after each phase; keep shared
      cancellation, transaction, and command-lane ownership centralized.

## Verification matrix

### Every behavior-changing commit

- [x] Record the exact red focused command and its expected failing assertion.
- [x] Record the exact green focused command and result.
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `API_TEST_ENABLED=false npm run test:ci`
- [x] Live configured staging integration tests with approved network access.
- [x] `npm run quality:inventory`
- [x] `git diff --check` and explicit staged/unstaged inspection.
- [x] `rg -n 'app-btn[^\"]*bg-' src --glob '*.tsx'` returns no matches.
- [x] Production-like MapLibre source-injection contract tests pass.
- [x] Full dependency audit reports no runtime or development advisories.

### Persistence/concurrency-specific

- [x] Real fake-IndexedDB transaction completion/abort evidence.
- [x] Reopen-after-failure/force-quit tests, not only in-memory assertions.
- [x] Deferred transport/write/delete tests at the exact awaited boundary.
- [x] Logout cancellation tests settle ignored/late dependencies after purge.
- [x] Repeated covered suite runs remain deterministic and leak no timers,
      listeners, transactions, or console output.

### Native/build-specific

- [x] `npx cap sync android` and `npx cap sync ios`; inspect every tracked diff.
- [x] Android unit tests, lint, Debug/Release APK, Release AAB, and
      instrumentation-test compilation.
- [x] iOS signed simulator XCTest plus unsigned generic-device Debug and Release
      compilation.
- [x] Final merged Android manifest, iOS entitlements, privacy manifest,
      background modes, version/build numbers, and bundle IDs inspected.
- [ ] Trusted publisher-signed artifacts installed as both fresh and upgrade
      installs before distribution.

### Physical-device release gates

- [ ] Android: logout during pending mutation/replay, force-quit persistence,
      offline-map replacement/restart/storage pressure, background/lock GPS,
      notification denial, battery optimization, and cached-map p95.
- [ ] iOS minimum and latest: the same logout/persistence/offline-map/GPS cases,
      keychain upgrade, background indicator, and store privacy validation.
- [ ] Android + iOS heading: cardinal directions, 359°↔0° wrap, portrait and
      both landscapes, pause/resume/toggle/route/background suspension, and
      unavailable-sensor fallback.
- [ ] Record device model, OS/WebView version, build hash, commands, timings,
      screenshots/log disposition, and limitations. Never label compilation as
      device evidence.

## Baseline review record (2026-07-12)

### Repository and history

- Worktree was clean at audit start; `master` contained the current dependency
  update and no user edits.
- 557 tracked files: 162 production TypeScript, 114 TypeScript tests, 86
  Android, 34 iOS, 98 documentation, plus styles/assets/tooling/declarations.
- Reviewed range: 62 commits after `d556d235...` through `3d0307e`, including
  the prior security hardening and adversarial offline-map correction records.

### Passing baseline

- `npm run quality:inventory` — pass, all 557 tracked files classified.
- `npm run lint` — pass.
- `npm run typecheck` — pass.
- `npm run build` — pass; bundle budgets enforced.
- `API_TEST_ENABLED=false npm run test:ci` — 109 files passed, 2 integration
  files intentionally skipped; 1,830 passed / 13 skipped tests. Coverage: 90.02%
  statements, 82.13% branches, 92.29% functions, 92.01% lines.
- Configured staging integration tests with network access — 2 files / 13 tests
  passed.
- `npm audit --omit=dev --audit-level=moderate` — zero vulnerabilities.
- `npm audit --audit-level=moderate` — zero vulnerabilities.
- Android
  `./gradlew testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest`
  — pass, 1,200 tasks; no tracked native drift.
- iOS
  `xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'platform=iOS Simulator,id=5B3096E9-8E15-4699-958A-BA72C99D5AD7' -derivedDataPath /tmp/speleodb-release-audit-ios test`
  — pass, all 10 native tests on an iPhone 17 Pro / iOS 26.4 simulator.
- Hard button scan — zero forbidden matches.
- No `.skip`, `.only`, focused tests, TODO/FIXME/HACK markers, or dirty
  generated native output found.

### Baseline limitations

- The first full suite run inside the network sandbox had 12 integration
  failures caused solely by `ENOTFOUND stage.speleodb.org`; the same 13 staging
  tests passed with approved network access. This is environment evidence, not a
  product failure.
- The first iOS XCTest attempt reached a cold simulator before boot/data
  migration completed and was interrupted while waiting for workers. After an
  explicit `simctl boot` + blocking `bootstatus`, the unchanged command passed.
  This is environment/startup evidence, not a product-test failure.
- No physical Android was attached, and simulator/native compilation cannot
  close any physical-device gate.
- CI tag artifacts remain disposable compile-smoke artifacts and must not be
  distributed.

## Implementation review

Approved for implementation on 2026-07-12. Each completed RR item will add exact
red/green commands, results, limitations, and diff-inspection evidence here.
Final commit hashes will be recorded in the closing review-ledger commit because
a commit cannot contain its own stable final hash.

### RR-001 — Independent logout cache cleanup

- **RED:** `npx vitest run src/services/ProjectCacheService.test.ts` — failed as
  expected: 3 failures proved the original store error leaked, later clears were
  skipped, and a pending operation remained after controller logout.
- **GREEN:** unchanged focused command — 38/38 tests passed. Failure injection
  covers both first-store and second-store rejection; controller coverage reads
  the durable offline/GPS stores after the rejected logout.
- **Gates:** `npm run lint`, `npm run typecheck`, `npm run build`,
  `API_TEST_ENABLED=false npm run test:ci` (109 files, 1,833 passed, 13
  skipped), live staging integration (2 files, 13 passed),
  `npm run quality:inventory`, runtime/full `npm audit`, and the hard button
  scan passed. The full suite also includes the MapLibre source-injection
  contracts.
- **Limitations:** native projects and generated assets are unchanged, so native
  compilation is deferred to the final cross-platform gate. Physical-device
  evidence remains an explicit physical-device release gate.

### RR-002 — Cancellable user-operation lifetime

- **RED:** `npx vitest run src/controllers/SpeleoDBController.test.ts` — 8
  expected failures proved landmark create/update/delete, collection loading,
  offline replay, remote GPS edit/delete, and lazy GPS geometry download did not
  receive an abort signal and could outlive logout.
- **GREEN:** the same controller command passed 194/194 tests. The related
  session, GPS coordinator/mutation, cache, and logout matrix passed 337/337
  tests across 5 files. Deferred transports deliberately ignored cancellation;
  logout waited for settlement while every late mutation, cache write, revision
  publication, and offline-op removal remained blocked.
- **Gates:** lint, typecheck, build, inventory, runtime/full dependency audits,
  hard button scan, and live staging integration (2 files, 13 tests) passed. The
  deterministic covered suite passed 109 files / 1,841 tests with 13 tests
  skipped only because staging was disabled for that command. MapLibre contract
  tests are included in that suite.
- **Design/performance:** one generation-scoped cancellation context is shared
  by admitted user operations. It adds constant-time tracking and signal
  forwarding, no polling or extra requests. Invalidated offline queues suppress
  stale callbacks.
- **Limitations:** native source and generated projects are unchanged; native
  compilation remains in the final cross-platform gate. Physical-device logout
  races remain an explicit physical-device release protocol.

### RR-014 — Pending-operation loss acknowledgement

- **RED:** `npx vitest run src/pages/Settings.test.tsx` — 5 expected failures
  proved the voluntary sign-out modal had no conditional warning/count,
  acknowledgement gate, reset behavior, or consent-aware duplicate protection.
- **GREEN:** the unchanged focused command passed 66/66 tests. Coverage includes
  zero/one/multiple pending operations, exact singular/plural copy, disabled
  destructive action, cancel and count-change reset, unchanged-count retry, and
  busy duplicate prevention. The existing controller/session tests in the full
  suite continue to prove forced unauthorized logout is non-interactive.
- **Gates:** lint, typecheck, build, inventory, runtime/full dependency audits,
  hard button scan, and the deterministic covered suite passed. The suite
  reported 109 files / 1,846 passed tests and 13 staging-only skips; MapLibre
  contracts remain green.
- **Design/performance:** consent is stored as the exact acknowledged pending
  count, so a live count change invalidates it without an effect, storage read,
  polling, or extra render cascade.
- **Limitations:** staging transport, native projects, and generated assets are
  unchanged, so live API and native compilation are inapplicable to this UI-only
  RR item and remain covered by RR-002/final gates. Physical interaction remains
  part of the physical-device release checks.

### RR-003 — Atomic confirmed ground-truth mutations

- **RED:**
  `npx vitest run src/services/ProjectCacheService.test.ts src/controllers/SpeleoDBController.test.ts src/offline/OfflineOpQueue.test.ts src/controllers/GpsTrackCoordinator.test.ts`
  — 5 expected failures proved the strict cache APIs did not exist, confirmed
  landmark/GPS mutations reported success after cache failure, and create replay
  posted despite a matching fresh server result.
- **GREEN:** the unchanged focused command passed 295/295 tests. Real
  fake-IndexedDB coverage proves concurrent collection mutations serialize and a
  transaction abort preserves the previous record; owning-seam tests prove
  storage errors block revision publication and offline-op removal. Create
  replay preflights stable identity and refreshes again after a duplicate
  response.
- **Design/performance:** landmark and GPS ground truth now use one strict
  `CacheStore.update()` transaction per confirmation. This removes split-read
  lost updates without polling, additional network traffic, or collection copies
  beyond the required immutable update.
- **Gates:** lint, typecheck, build, inventory, runtime/full dependency audits,
  hard button scan, and configured staging integration (2 files / 13 tests)
  passed. The final deterministic covered suite passed 109 files / 1,854 tests
  with 13 staging-only skips; coverage was 90.02% statements, 81.96% branches,
  92.44% functions, and 92.06% lines. MapLibre contract tests remain green.
- **Limitations:** native source and generated projects are unchanged; native
  compilation remains in the final cross-platform gate. Physical-device storage
  interruption remains a physical-device protocol.

### RR-004 — Serialized offline replay commands

- **RED:** `npx vitest run src/offline/OfflineOpQueue.test.ts` — 3 expected
  failures proved overlapping full replay, full-plus-single replay, and
  duplicate conflict resolution each issued the same remote POST/PATCH twice.
- **GREEN:** the unchanged focused command passed 47/47 tests. Compatible full
  replay callers share the exact promise/summary; incompatible per-op and
  conflict commands serialize and re-read the queue after admission. A rejected
  shared flight leaves the lane reusable and the durable operation retryable.
- **Design/performance:** a queue-owned promise tail provides synchronous
  admission with constant-time bookkeeping. It adds no timers, polling,
  persistence, or network requests and prevents redundant snapshot pulls.
- **Gates:** lint, typecheck, build, inventory, runtime/full dependency audits,
  hard button scan, and configured staging integration (2 files / 13 tests)
  passed. The deterministic covered suite passed 109 files / 1,858 tests with 13
  staging-only skips; coverage was 90.09% statements, 81.98% branches, 92.51%
  functions, and 92.12% lines. MapLibre contract tests remain green.
- **Limitations:** queue persistence replacement is intentionally deferred to
  RR-005. Native source and generated projects are unchanged; native compilation
  remains in the final cross-platform gate.

### RR-005 — Atomic offline-operation replacement

- **RED:**
  `npx vitest run src/offline/OfflineOpStore.test.ts src/offline/OfflineOpQueue.test.ts`
  — 7 expected failures proved both missing store-level atomic
  replacement/rollback and all four landmark/GPS update↔delete failure windows.
  Reopening showed a lost old intent or duplicate records, while simultaneous
  same-subject enqueues produced two durable ops.
- **GREEN:** the unchanged focused command passed 59/59 tests. Real
  fake-IndexedDB abort coverage reopens the old record after rollback; all four
  queue replacement directions retain the prior in-memory and durable intent on
  failure. Simultaneous enqueues deterministically coalesce to the latest
  intent.
- **Design/performance:** every public queue mutation now shares the serialized
  command lane. `CacheStore.replace()` removes the old key and writes the new
  record in one transaction, while memory/sequence/revision publication occurs
  only after commit. This adds no reads, polling, or network work.
- **Gates:** lint, typecheck, build, inventory, runtime/full dependency audits,
  hard button scan, and configured staging integration (2 files / 13 tests)
  passed. The deterministic covered suite passed 109 files / 1,865 tests with 13
  staging-only skips; coverage was 90.25% statements, 82.16% branches, 92.65%
  functions, and 92.30% lines. MapLibre contract tests remain green.
- **Limitations:** native source and generated projects are unchanged; native
  compilation remains in the final cross-platform gate.

### RR-006 — Honest GPS persistence results

- **RED:**
  `npx vitest run src/controllers/GpsTrackCoordinator.test.ts src/controllers/GpsRecordingCoordinator.test.ts src/pages/dashboard/useDashboardGpsRecordingActions.test.ts`
  — 7 expected failures plus one unhandled rejection proved incremental/final
  write errors were hidden or unhandled, failed deletions disappeared in memory,
  fatal recovery claimed “saved” early, and Dashboard stop had no rejection
  path.
- **GREEN:** the focused GPS coordinator/recording/Dashboard action matrix
  passed 58/58 tests; the expanded public-controller/global-toast matrix passed
  256/256. Coverage proves incremental error reporting, final-save retry with
  all points retained, fatal-callback success/failure publication, strict local
  deletion, failed discard retention, command-lane recovery, and a fixed
  actionable stop error that keeps the recorder open.
- **Design/performance:** the existing serialized write lane now propagates its
  tracked promise. State publication follows durable completion; failures retain
  the authoritative in-memory buffer/row. No extra writes, reads, polling, or
  point copies were added.
- **Gates:** lint, typecheck, build, inventory, runtime/full dependency audits,
  hard button scan, and configured staging integration (2 files / 13 tests)
  passed. The deterministic covered suite passed 109 files / 1,870 tests with 13
  staging-only skips; coverage was 90.23% statements, 82.12% branches, 92.66%
  functions, and 92.33% lines. MapLibre contract tests remain green.
- **Limitations:** physical background/permission-loss behavior remains an
  physical-device protocol. Native source and generated projects are unchanged.

### RR-007 — Serialized GPS recording transitions

- **RED:**
  `npx vitest run src/controllers/GpsRecordingCoordinator.test.ts src/pages/dashboard/useDashboardGpsRecordingActions.test.ts`
  — 6 expected failures plus one unhandled rejection proved overlapping commands
  returned independent promises, invalid states resolved silently, pause/resume
  errors disappeared, and battery-optimization failures escaped the UI.
- **GREEN:** the unchanged owning-seam command passed 37/37 tests. The expanded
  coordinator/controller/Dashboard/native-watcher/session matrix passed 321/321,
  including duplicate start/pause/resume/stop/discard, incompatible start→pause,
  invalid-state rejection, rejection recovery, fatal callbacks, and logout.
- **Design/performance:** one keyed promise map and serialized tail provide
  synchronous admission. Compatible calls share exact results; incompatible
  calls validate state when executed. This is constant-time bookkeeping with no
  timers, polling, extra persistence, or duplicate native work.
- **Gates:** lint, typecheck, build, inventory, runtime/full dependency audits,
  hard button scan, and configured staging integration (2 files / 13 tests)
  passed. The deterministic covered suite passed 109 files / 1,878 tests with 13
  staging-only skips; coverage was 90.27% statements, 82.05% branches, 92.73%
  functions, and 92.36% lines. MapLibre contract tests remain green.
- **Limitations:** physical repeated-tap/background/lifecycle behavior remains a
  physical-device protocol. Native source and generated projects are unchanged.

### RR-010 — Audited coverage enforcement

- **RED:** `npx vitest run src/coverageThresholds.test.ts` — 2 expected failures
  proved `vite.config.ts` exposed no global or critical-module thresholds. The
  contract test was then placed in the `quality/` tooling boundary so
  application TypeScript does not import the separately compiled Vite config
  project.
- **GREEN:** `npx vitest run quality/coverage-thresholds.test.ts` passed 2/2.
  `API_TEST_ENABLED=false npm run test:ci` passed 110 files / 1,880 tests with
  13 staging-only skips while enforcing every threshold. Coverage was 90.27%
  statements, 82.05% branches, 92.73% functions, and 92.36% lines.
- **Negative control:** a one-off 100% CLI override ran the same coverage engine
  against the contract test and exited 1 with explicit
  statement/branch/function/ line threshold failures, proving enforcement is
  active rather than report-only.
- **Design:** global floors preserve the audited repository baseline; stronger
  exact-file floors protect session, GPS-transition, replay, and IndexedDB
  seams. `autoUpdate` and `perFile` are intentionally false. No application
  exclusions were added; the staged 100%-per-file path is documented in
  `docs/ci.md`.
- **Gates:** lint, typecheck, build, inventory, runtime/full dependency audits,
  hard button scan, and configured staging integration (2 files / 13 tests)
  passed. The covered suite is now itself the blocking threshold gate; MapLibre
  contract tests remain green within it.
- **Limitations:** this gate measures browser TypeScript. Native, static-asset,
  build-tooling, and physical-device evidence remain separate release gates.

### RR-011 — Correct SpeleoDB PWA metadata

- **RED:** `npx vitest run quality/pwa-metadata.test.ts` — 2 expected failures
  at the emitted artifact proved the built title remained “Ionic App” and
  `/app-icon.png` did not exist. The harness build disables only bundle-budget
  enforcement because Vitest instrumentation inflates chunks; standalone build
  retains that independent gate.
- **GREEN:** the unchanged command passed 2/2. It builds into an isolated temp
  directory, resolves every local HTML link/script and manifest icon, asserts
  SpeleoDB document/Apple/manifest branding, validates PNG signatures, and
  compares encoded dimensions with declared 180/192/512px sizes.
- **Design/performance:** three exact-size renditions were generated from the
  existing reviewed `resources/icon.png` source. They total 99,091 bytes, have
  opaque navy backgrounds, and declare `purpose: any` rather than making an
  unreviewed maskable-safe-area claim. No application JavaScript was added.
- **Gates:** lint, typecheck, threshold-enforced coverage, standalone build with
  bundle budgets, inventory, runtime/full dependency audits, hard button scan,
  and configured staging integration (2 files / 13 tests) passed. The covered
  suite passed 111 files / 1,882 tests with 13 staging-only skips. A localhost
  preview returned 200 + `application/json` for the manifest and 200 +
  `image/png` for every icon; MapLibre contracts remain green.
- **Limitations:** browser/PWA metadata is covered here. Native icon resources
  are unchanged and remain subject to final Capacitor/native inspection.

### RR-012 — Runtime-aligned release documentation

- **RED:**
  `npx vitest run quality/release-documentation-contract.test.ts --reporter=dot`
  — after removing one line-wrap-sensitive harness assertion, 3 expected
  failures proved that the native checklist still required automatic replay,
  rejected recording after notification denial, and claimed deep-link URL
  payloads were logged. The existing logout and durable GPS-save contracts
  passed in the same run.
- **GREEN:** the unchanged focused command passed 4/4. The persistent contract
  scopes assertions to the owning checklist sections and tolerates Markdown line
  wrapping while rejecting the contradictory behaviors.
- **Design/performance:** the native checklist now separates deterministic web/
  fake-IndexedDB evidence from packaged-native and physical-device evidence. It
  requires explicit Pending replay, treats Android notification permission as
  best-effort, records destructive sign-out behavior, and requires device/build
  identity for manual results. Deep-link diagnostics document the fixed,
  payload-free event label. No runtime code or shipped payload changed.
- **Gates:** lint, typecheck, production build with bundle budgets, runtime/full
  dependency audits (zero vulnerabilities), hard button scan, and configured
  staging integration (2 files / 13 tests) passed. The threshold-enforced suite
  passed 112 files / 1,886 tests with 13 staging-only skips; coverage remained
  90.27% statements, 82.05% branches, 92.73% functions, and 92.36% lines.
  MapLibre contracts remained green within the complete suite.
- **Limitations:** this correction makes the protocols truthful; it does not
  manufacture emulator, physical-device, store-console, or trusted-signing
  evidence. Those remain physical-device and RR-009 gates.

### RR-009 — Trusted release ceremony

- **RED:** `npx vitest run quality/release-ceremony.test.ts --reporter=dot`
  failed at the owning documentation seam with `ENOENT` for the absent ceremony;
  all 4 version/identity/evidence/authorization contracts were skipped.
- **GREEN:** after making two line-wrap-sensitive assertions semantic, the
  unchanged focused command passed 4/4. It requires monotonic cross-platform
  versions, independently known publisher identities, clean/upgrade installs,
  store validation, symbols/mappings, artifact-to-source hashes, independent
  approval, forward-fix rollback, and the no-publish boundary.
- **Design/security:** `docs/release-ceremony.md` names the current
  `1.3.0 (130)` native version sources and exact verification commands without
  storing a key, password, profile, store credential, or publishing permission.
  It treats disposable CI artifacts as compile-only and requires protected
  ephemeral signing plus an independent expected certificate/team record.
- **Gates:** lint, typecheck, production build with bundle budgets, Prettier,
  runtime/full dependency audits (zero vulnerabilities), hard button scan, and
  configured staging integration (2 files / 13 tests) passed. The
  threshold-enforced suite passed 114 files / 1,894 tests with 13 staging-only
  skips; coverage remained 90.27% statements, 82.05% branches, 92.73% functions,
  and 92.36% lines. MapLibre contracts remained green. The post-stage inventory
  classified all 578 tracked files with no gaps or overlaps.
- **External evidence:** no trusted key was accessed and no artifact was signed,
  uploaded, installed, validated by a store, tagged, or published. Those actions
  require separate authorization; until their hashes, installation matrices,
  symbols, store receipts, and two-person approval exist, release remains
  blocked.

### RR-013 — Audited Android Gradle deprecations

- **RED:** `npm run test.unit -- --run quality/gradle-deprecation-audit.test.ts`
  failed 1/1 because both installed Android plugins still used Gradle's
  deprecated Groovy space-assignment syntax for `namespace` and `abortOnError`.
- **GREEN:** the unchanged focused command passed after extending the existing
  deterministic native-package postinstall hook. The hook converts all four
  assignments to explicit `=` syntax and fails closed if a future plugin version
  contains neither the audited legacy form nor the compatible form.
- **Warning audit:**
  `./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug --warning-mode all --console=plain`
  initially identified exactly four plugin syntax warnings and one
  Capacitor-generated `flatDir` warning. A clean dependency install/non-cached
  compile additionally exposed Sentry's `PackageInfo.versionCode` use and
  Capacitor Filesystem's internal deprecated `downloadFile` compatibility call.
  The unchanged command remained green with those three attributed
  third-party/generated categories. `docs/android-gradle-warnings.md` records
  owner, impact, exact source, and removal conditions for every finding.
- **Design/performance:** no dependency or Gradle version changed. The
  compatible correction reuses the repository's existing postinstall
  compatibility seam; it performs two small install-time rewrites and adds no
  shipped runtime work. Capacitor's generated Cordova build file remains
  unmodified so `cap sync` remains reproducible.
- **Gates:** lint, typecheck, production build with bundle budgets, focused
  postinstall idempotence, hard button scan, and the MapLibre contracts passed.
  A clean `npm ci` applied the compatibility transforms from unmodified locked
  packages and reported zero dependency vulnerabilities. The threshold-enforced
  suite passed 115 files / 1,896 tests with 13 staging-only skips; coverage
  remained 90.27% statements, 82.05% branches, 92.73% functions, and 92.36%
  lines. `npx cap sync android` completed with no tracked native drift, and the
  post-sync Android unit/lint/debug build remained green with only the
  documented warning categories.
- **Limitations:** the remaining `flatDir` declaration is Capacitor 8.4.1
  generated output and currently resolves no local JAR/AAR. Sentry's deprecated
  release-version read is upstream runtime logic; Filesystem's deprecated method
  is not invoked by SpeleoDB's GPX export. None is suppressed; any additional
  warning remains a release failure. Their removal requires reviewed upstream
  changes or a separately tested compatibility correction.
- **Post-commit Release correction:** the first complete clean Release matrix
  after `f830602` forced tasks that the debug audit had not executed and exposed
  three more warning classes: 13 background-geolocation Android/Play Services
  deprecations, one Filesystem legacy-download nullability mismatch, and Sentry
  native-library strip notices. The expanded quality contract failed before the
  ledger named those exact sources. The unchanged test then passed after the
  audit documented every API/line/owner and added a reusable Java
  `-Xlint:deprecation` init script. No warning was suppressed and no dependency
  or native runtime implementation changed.
- **Corrective native gate:**
  `./gradlew testDebugUnitTest lint assembleDebug assembleRelease bundleRelease assembleDebugAndroidTest --warning-mode all --console=plain`
  passed 1,845 tasks (1,158 executed / 687 up-to-date), producing Debug and
  unsigned Release APKs, a Release AAB, and the app instrumentation APK. The
  remaining warning classes are the documented third-party/generated exceptions;
  the worktree remained free of generated native drift.
- **Corrective repository gates:** lint and typecheck passed. The complete
  threshold-enforced suite passed 115 files / 1,896 tests with 13 staging-only
  skips and unchanged 90.27% / 82.05% / 92.73% / 92.36% coverage. The hard
  button scan, MapLibre contracts, diff check, and 581-file tracked inventory
  passed.

## Final remediation ledger (2026-07-12)

### Repository outcome

All 14 confirmed RR items have repository-owned remediation, regression
evidence, documentation, and focused commits. RR-013 required one additional
corrective commit when the final clean Release build forced plugin tasks that a
debug audit had kept up to date; the correction remained scoped to warning
attribution and audit tooling. No product change is hidden in this closing
ledger.

The repository remediation is green, but **distribution remains blocked** until
the unchecked physical-device and trusted publisher signing, fresh/upgrade
installation, store validation, symbol retention, hash, and independent approval
gates are executed. Compilation artifacts below are disposable evidence and are
not authorized release candidates.

### Commit ledger

| Scope             | Commit                                     | Subject                                                       |
| ----------------- | ------------------------------------------ | ------------------------------------------------------------- |
| Plan              | `a6d12815b814be580d7f7f1744e078e0a6ac1056` | `[Docs] Add July 2026 release readiness plan`                 |
| RR-001            | `1b2bf9dd9dc48997e01e8d488c64cf4e15e60130` | `[Fix] Make logout cache cleanup failure independent`         |
| RR-002            | `f13616632772fa3e5919a80aa0fa7c70eb4bc13f` | `[Fix] Cancel user operations during logout`                  |
| RR-014            | `48a3a951623f6d88983dc81f6df333b37f30268c` | `[Feature] Warn before discarding pending offline operations` |
| RR-003            | `224d522ea0a999e2d8df96e59c6fe2a06431cf5b` | `[Fix] Make confirmed cache mutations atomic`                 |
| RR-004            | `8aeab96d9672ade69adb246fd07d7cfac2a8b3ce` | `[Fix] Serialize offline operation replay`                    |
| RR-005            | `d18d70ebea9117f98b58bc27cf3d589172503346` | `[Fix] Make offline operation replacement atomic`             |
| RR-006            | `7cc6876e995b5b167d9cd5080470e40fc9c8f5c1` | `[Fix] Report GPS persistence failures`                       |
| RR-007            | `422f6988a7b38df5edea24537b1b133098f1c30b` | `[Fix] Serialize GPS recording transitions`                   |
| RR-010            | `6a2acf18cfcaf45c07c8cd612226ed0ed181047d` | `[Test] Enforce audited coverage thresholds`                  |
| RR-011            | `09e7981e336259cf2f5e0a4a63d605a92d878011` | `[Fix] Correct SpeleoDB PWA metadata`                         |
| RR-012            | `e8073b2cc722fd8fbf63b4ad9d2e32ee71559134` | `[Docs] Align release documentation with runtime behavior`    |
| RR-009            | `5fc443778c6c218d26a1a1f1a867c14bc4e2b000` | `[Docs] Define trusted release ceremony`                      |
| RR-013            | `f830602c08222a2eca3b3f6060db45c119257e75` | `[Chore] Audit Gradle deprecation warnings`                   |
| RR-013 correction | `4efa69d31cb58052b09e8e4a7db8894d4da94db7` | `[Fix] Complete Gradle warning attribution`                   |

The documentation-only closing commit cannot record its own stable hash; its
subject is `[Docs] Record release remediation results` and it is verified after
creation.

### Final web and integration verification

- `npm ci` installed the 726 locked packages, ran every deterministic native
  compatibility patch from fresh package sources, and reported zero
  vulnerabilities.
- `npm run lint`, `npm run typecheck`, and `npm run build` passed; bundle
  budgets remained enforced.
- `API_TEST_ENABLED=false npm run test:ci` passed 115 files with 2 configured
  staging files skipped: 1,896 passed / 13 skipped tests. Coverage was 90.27%
  statements, 82.05% branches, 92.73% functions, and 92.36% lines; all global
  and critical-module thresholds passed.
- Configured staging integration passed 2 files / 13 tests with approved network
  access.
- `npm audit --omit=dev --audit-level=moderate` and
  `npm audit --audit-level=moderate` both reported zero vulnerabilities.
- `npm run quality:inventory` classified all 581 tracked files with no gap or
  overlap. The hard button scan returned zero matches, the MapLibre
  owning-source contracts passed in the complete suite, and `git diff --check`
  was clean.
- RR-specific sections above preserve every exact RED/GREEN command, expected
  failure, corrected result, performance consideration, and limitation.

### Final native verification

- `npx cap sync` completed for Android and iOS with all 14 Android and 13 iOS
  plugins; inspection found no tracked native or generated-asset drift.
- Android
  `./gradlew testDebugUnitTest lint assembleDebug assembleRelease bundleRelease assembleDebugAndroidTest --warning-mode all --console=plain`
  passed 1,845 tasks (1,158 executed / 687 up-to-date). It produced Debug and
  unsigned Release APKs, a Release AAB, and the app instrumentation APK. All
  remaining third-party/generated diagnostics are enumerated in
  `docs/android-gradle-warnings.md` rather than suppressed.
- Xcode 26.6 (17F113) XCTest passed all 10 tests on iPhone 17 Pro / iOS 26.4.
  Unsigned generic-device Debug and Release builds both passed with
  `CODE_SIGNING_ALLOWED=NO`.
- The merged Android manifest identifies `org.speleodb.app` version `1.3.0`
  (`130`), min SDK 24, target SDK 36, no cleartext traffic or backup, and the
  required location/foreground-service declarations.
- The built iOS Release Info.plist identifies `org.speleodb.app` version `1.3.0`
  (`130`), minimum iOS 15.0, location-only background mode, HTTPS transport,
  SpeleoDB deep-link scheme, and the expected location purpose strings.
- Source and built plists passed `plutil -lint`. Associated-domain and complete-
  until-first-authentication data-protection entitlements were present. The
  built privacy manifest declares precise location, crash/diagnostic data, disk
  space/file-timestamp accessed APIs, and no tracking.

Disposable compile-artifact SHA-256 values (not release approval):

| Artifact                              | SHA-256                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| Android Debug APK                     | `999ce4c47f76d7a4973135312c0db93e4cdd28b0c8b6d5d67597e722cc8562d6` |
| Android unsigned Release APK          | `bcec7560eadb0e6fbb369e0decbb1bde451554089faf7e4d8a76830f5eeeaf48` |
| Android Release AAB                   | `1d1cfabeeb10b32f9907f1e4b23390cf7c8f542d353a8729dddbc7d96deb1dd1` |
| Android instrumentation APK           | `fc0df534bbb37785d3673ffe243ff6953108fe2da3f367f40a7497a7742e8b34` |
| iOS generic-device Debug executable   | `6af0188432046a6ad16c96bdfd70ff4e08009f6c477577dd1c2b5fc3e0ca5e89` |
| iOS generic-device Release executable | `c9ba3b16730dfbf18805a39ba26991de7795af1243e5d2a06ebe8956ffb198a3` |

### External blockers and authorization boundary

- No physical Android or iOS device evidence exists for logout races,
  force-quit/reopen storage, offline-map pressure, background/lock GPS,
  notification denial, battery optimization, compass rotation, or performance
  percentiles.
- No trusted publisher key/profile was accessed. No publisher-signed artifact,
  clean/upgrade install, Play/App Store validation, production symbol bundle,
  trusted `SHA256SUMS`, independent approval, rollout, or rollback drill exists.
- No commit was pushed; no PR, tag, GitHub release, store upload, release
  signing change, credential change, or publication was created.
