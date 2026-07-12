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

The ignored backend checkout is out of scope. Its HTTP contracts remain in
scope through service/controller tests and the configured staging integration
tests. No release, tag, push, store submission, or credential change is
authorized by this task.

## Commit discipline

Each RR item is an independent, green delivery unit. For every item: add and
run the red regression test, implement the root-cause fix, run the focused and
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
13. `[Test] Add cross-platform release workflows` — RR-008
14. `[Docs] Define trusted release ceremony` — RR-009
15. `[Chore] Audit Gradle deprecation warnings` — RR-013
16. `[Docs] Record release remediation results`

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
  performance, or maintainability defect that should be resolved in this
  release program but does not itself expose or destroy user data.
- **P3 — follow-up:** low-risk ecosystem/tooling debt with no demonstrated
  current product failure.

## Audit scope and evidence

- [x] Read `AGENTS.md`, `docs/coding-rules.md`, architecture guidance, the
      complete lessons inventory, and the prior hardening/offline-map ledgers.
- [x] Classify all 557 tracked files and inspect the production/test/native
      inventory.
- [x] Review the 62-commit range after `d556d235...`, with detailed attention to
      session hardening, controller extraction, offline-map replacement,
      GeoJSON validation, MapLibre composition, GPS/live heading, CI, and the
      final dependency updates.
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

Owning seams: controller user-operation lifetime, mutation coordinators,
offline replay port, and service request `AbortSignal` forwarding.

- [x] **RED:** add deferred controller tests for in-flight landmark create,
      landmark/GPS edit/delete, collection/geometry load, and offline replay.
      Start each operation, begin logout, settle the ignored transport after
      teardown, and assert: transport sees abort, logout waits for admitted
      work, no cache write occurs, no revision publishes, no op is removed, and
      no old-session data reappears.
- [x] Run the focused tests and record every stale publication/write.
- [x] **GREEN:** create one controller-owned cancellable user-operation lifetime,
      track admitted mutations/replays, pass its signal through every service
      wrapper and replay port, recheck authority after each awaited persistence
      boundary, and abort/reset it during logout before cache deletion.
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

- [ ] **RED:** add Settings tests for zero, one, and multiple pending operations;
      assert the current modal lacks the conditional warning and required
      acknowledgement and permits destructive sign-out without agreement.
- [ ] **GREEN:** when the count is positive, show “Pending offline operations
      will be lost,” the exact singular/plural count, and the statement that the
      operations cannot be recovered or synchronized later. Require the user to
      check “I understand that these pending offline operations will be
      permanently deleted and are unrecoverable” before enabling sign-out.
- [ ] Reset acknowledgement when the modal closes or the count changes. Preserve
      it for an in-place retry only when the count is unchanged. Disable
      dismissal and duplicate actions while logout runs.
- [ ] Prove zero pending operations preserve the existing flow and forced
      unauthorized logout never waits for UI consent.

#### RR-003 — Confirmed mutations can corrupt or silently fail ground-truth cache publication

Landmark and remote-GPS cache updates use separate best-effort read/write calls.
Read errors are converted to `null`/`[]`, so a later successful write can replace
the complete collection with one item (or empty it). Write methods return
`false`, but mutation callers ignore that result, publish success, and offline
replay removes the durable op. Concurrent read/modify/write calls can also lose
one another. The visible marker/track can disappear or revert immediately even
though the server accepted the user's mutation.

Owning seams: `CacheStore.update()`, strict project-cache mutation APIs,
controller landmark apply, and GPS remote apply.

- [ ] **RED:** add real fake-IndexedDB transaction tests for concurrent
      upserts/removals, read failure, write abort/failure, and offline-replay
      finalization. Assert unrelated ground truth is preserved and the op is
      retained until the confirmed server result is durably reflected.
- [ ] Run the focused tests and record the lost-update/failure-opaque results.
- [ ] **GREEN:** replace best-effort split read/write mutation paths with strict,
      atomic single-transaction cache mutations. Only publish revisions and
      remove offline ops after transaction completion. Keep best-effort cache
      APIs only for genuinely optional snapshots.
- [ ] For create replay, preflight the freshly pulled server snapshot by stable
      identity before POST so retry after a local commit failure cannot create a
      duplicate remote landmark.
- [ ] Rerun cache, controller, offline-queue, and integration suites.

#### RR-004 — Offline replay admits concurrent runs and can duplicate remote mutations

`OfflineOpQueue.syncAll()`, `syncOne()`, and conflict resolution set a boolean
but do not serialize or coalesce callers. Two user actions admitted before the
React busy state rerenders can pull the same snapshot and issue the same POST or
PATCH concurrently. Landmark creation has no client idempotency key, so this can
create duplicate remote landmarks.

- [ ] **RED:** defer the replay pull/POST, start two replay commands, and assert
      current code issues two remote mutations for one op.
- [ ] **GREEN:** add a queue-owned command lane/single-flight replay contract.
      Define whether compatible callers share a summary or serialize; never
      allow the same op to execute concurrently.
- [ ] Rerun mixed-entity, per-op, conflict, network-interruption, and force-quit
      replay tests.

#### RR-005 — Offline-op replacement is neither atomic nor concurrency-safe

Replacing update/delete intent persists the new record and removes the old
record in separate IndexedDB transactions. A failure or process death between
them leaves two durable ops for one subject; the in-memory queue can disagree
with disk. Concurrent enqueues can both observe no existing op and independently
append, violating the documented one-subject/one-op invariant.

- [ ] **RED:** add failure-injection and fake-IndexedDB tests for every
      update↔delete replacement boundary plus two simultaneous same-subject
      enqueues; reopen the queue and assert the current duplicate/divergent
      records.
- [ ] **GREEN:** serialize queue mutations and add one atomic store transaction
      for replace/remove+put. Update memory only after durable commit.
- [ ] Rerun load, coalescing, persistence-error, replay, and force-quit tests.

#### RR-006 — GPS recording reports durable success after storage rejection

`GpsTrackCoordinator.persist()` catches IndexedDB failure and resolves.
`GpsRecordingCoordinator.stop()` then returns a track, the Dashboard says
“Track saved,” and fatal permission loss says captured points “were saved.” A
force quit can lose the accepted track despite the explicit durability
contract. Local delete failures are also hidden while the item is removed from
memory, allowing deleted tracks to reappear after restart.

- [ ] **RED:** reject the final/incremental `GpsTrackStore.put()` and local
      delete ports. Assert stop/fatal finalization currently claims success and
      deletion currently disappears only in memory.
- [ ] **GREEN:** propagate durable write/delete results at user-command
      boundaries, retain a recoverable in-memory recording on final-save
      failure, and show a fixed actionable UI error. Fatal native callbacks must
      publish “saved” only after persistence completes; otherwise retain and
      surface recovery state without an unhandled rejection.
- [ ] Rerun GPS coordinator, recording UI, logout persistence, and force-quit
      recovery tests.

#### RR-007 — GPS recording transitions allow overlapping native commands

`start()` leaves state `idle` while awaiting permissions; `stop()`, `pause()`,
and `resume()` likewise expose their prior state through awaited watcher and
persistence calls. Real repeated taps can therefore admit two starts/stops and
race native watcher ownership or duplicate finalized tracks. The Dashboard also
fires stop/discard/pause/resume promises without complete rejection handling.

- [ ] **RED:** use deferred permission, watcher, and persistence ports to invoke
      same-turn and overlapping start/pause/resume/stop/discard commands; assert
      duplicate calls and unhandled UI outcomes.
- [ ] **GREEN:** give the recording coordinator synchronous command admission
      and a serialized transition lane, with explicit deterministic semantics
      for redundant/superseding commands. Add UI action ownership and fixed
      error feedback for every async command.
- [ ] Rerun recording, Dashboard action, native watcher, and lifecycle suites.

#### RR-008 — Critical device/E2E release evidence remains absent

The repository still has no cross-platform end-to-end app suite. Native tests
cover secure storage, scene/deep-link behavior, and screen-awake configuration,
but do not drive authentication, offline/online transitions, persistence across
force-quit, background GPS, offline-map replacement, or the new compass cone.
The existing task ledgers explicitly leave physical Android/iOS gates open.

- [ ] Define the smallest maintainable black-box harness that can run against
      Android and iOS without embedding production credentials in artifacts.
- [ ] Automate fresh-install login, cached relaunch, logout purge, pending-op
      persistence/replay, and basic map/GPS navigation on emulators/simulators.
- [ ] Keep background/lock, heading orientation, notification denial, storage
      pressure, and WebView performance as named physical-device protocols where
      automation cannot prove behavior.
- [ ] Record Android API 24/33/36 and minimum/latest iOS results. A release
      remains blocked until the required physical Android and iOS runs are
      supplied; the agent must not infer them from compilation.

#### RR-009 — Current CI artifacts are compile smoke, not distributable releases

CI intentionally signs Android/iOS tag artifacts with disposable identities.
That correctly proves compilation but not publisher identity, entitlements,
store eligibility, upgrade installation, symbol/mapping retention, or release
artifact reproducibility.

- [ ] Document the trusted manual/automated release ceremony: exact version
      bump, protected signing identity, clean install + upgrade install, store
      validation, symbol/mapping retention, artifact hashes, and rollback rule.
- [ ] Do not add secrets or publishing permissions without explicit user
      authorization. Record this as an external release gate if trusted signing
      is performed outside the repository.

### P2 — release hardening

#### RR-010 — Coverage is measured but not enforced

The deterministic suite reports 90.02% statements, 82.13% branches, 92.29%
functions, and 92.01% lines. There is no coverage threshold, and the critical
offline queue is only 77.79% statements / 63.12% branches. A regression can
lower coverage while CI remains green.

- [ ] Add regression tests from RR-001 through RR-007 at their owning seams.
- [ ] Add non-regression global and critical-file thresholds based on the new
      audited baseline; do not game coverage with exclusions or mirror tests.
- [ ] Record justified non-runtime exclusions and a staged path toward the
      repository's existing 100%-per-file completion gate.

#### RR-011 — Shipped web/PWA metadata references missing assets and stale product names

`public/manifest.json` references `/icons/icon.svg`, while no such file is
shipped. `index.html` references `/app-icon.png`, also absent from `dist`, and
uses “Ionic App” for the document and Apple home-screen titles. Native app names
are correct, but the web/PWA artifact has 404 icons and stale branding.

- [ ] **RED:** add a build-artifact metadata test that resolves every manifest
      and HTML icon path inside `dist` and asserts SpeleoDB titles.
- [ ] **GREEN:** ship one reviewed icon source at the referenced public path(s),
      use correct sizes/MIME metadata, and replace stale Ionic titles.
- [ ] Build and inspect the rendered manifest/icon responses.

#### RR-012 — Release documentation contradicts current behavior

`GPS_NATIVE_RELEASE_CHECKLIST.md` says reconnect drains pending GPS uploads
automatically, while the canonical queue requires explicit Pending-page replay.
It also says Android notification denial prevents recording, while current code
and `docs/app-permissions.md` deliberately allow recording with the notification
hidden. `docs/deep-linking.md` says the URL itself is logged, while code logs a
fixed event label. These contradictions can produce false release failures or
miss the actual contract.

- [ ] Align the native checklist and deep-link docs with code after behavior is
      locked by tests.
- [ ] Update logout, offline queue, GPS recording/track, persistence, testing,
      and release docs for every correction above, including performance impact
      and physical-device limits.

### P3 — follow-up debt

#### RR-013 — Android build reports Gradle ecosystem deprecations

The Android matrix passes, but Gradle reports plugin `flatDir` use and features
that will be incompatible with Gradle 10. These warnings currently originate in
the Capacitor/plugin build graph and do not demonstrate a shipped defect.

- [ ] Capture `--warning-mode all`, attribute each warning to repository or
      third-party ownership, and schedule only diagnosed compatible changes.
- [ ] Do not perform a blanket dependency or Gradle upgrade in this release
      task.

## Implementation order

- [ ] Phase 1: RR-001, RR-002, and RR-014 — close logout/cross-session privacy
      and require informed consent for pending-operation loss first.
- [ ] Phase 2: RR-003 through RR-005 — make cache and offline intent durable,
      atomic, and single-flight.
- [ ] Phase 3: RR-006 and RR-007 — make GPS save and native transitions honest
      and race-safe.
- [ ] Phase 4: RR-010 through RR-012 — enforce regression gates and align
      shipped metadata/documentation.
- [ ] Phase 5: RR-008 and RR-009 — run/record black-box, native-device, signing,
      install, and store-validation evidence.
- [ ] Reassess elegance and duplication after each phase; keep shared
      cancellation, transaction, and command-lane ownership centralized.

## Verification matrix

### Every behavior-changing commit

- [ ] Record the exact red focused command and its expected failing assertion.
- [ ] Record the exact green focused command and result.
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `API_TEST_ENABLED=false npm run test:ci`
- [ ] Live configured staging integration tests with approved network access.
- [ ] `npm run quality:inventory`
- [ ] `git diff --check` and explicit staged/unstaged inspection.
- [ ] `rg -n 'app-btn[^\"]*bg-' src --glob '*.tsx'` returns no matches.
- [ ] Production-like MapLibre source-injection contract tests pass.
- [ ] Full dependency audit reports no runtime or development advisories.

### Persistence/concurrency-specific

- [ ] Real fake-IndexedDB transaction completion/abort evidence.
- [ ] Reopen-after-failure/force-quit tests, not only in-memory assertions.
- [ ] Deferred transport/write/delete tests at the exact awaited boundary.
- [ ] Logout cancellation tests settle ignored/late dependencies after purge.
- [ ] Repeated covered suite runs remain deterministic and leak no timers,
      listeners, transactions, or console output.

### Native/build-specific

- [ ] `npx cap sync android` and `npx cap sync ios`; inspect every tracked diff.
- [ ] Android unit tests, lint, Debug/Release APK, Release AAB, and
      instrumentation-test compilation.
- [ ] iOS signed simulator XCTest plus unsigned generic-device Debug and Release
      compilation.
- [ ] Final merged Android manifest, iOS entitlements, privacy manifest,
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

- Worktree was clean at audit start; `main` contained the current dependency
  update and no user edits.
- 557 tracked files: 162 production TypeScript, 114 TypeScript tests, 86 Android,
  34 iOS, 98 documentation, plus styles/assets/tooling/declarations.
- Reviewed range: 62 commits after `d556d235...` through `3d0307e`, including
  the prior security hardening and adversarial offline-map correction records.

### Passing baseline

- `npm run quality:inventory` — pass, all 557 tracked files classified.
- `npm run lint` — pass.
- `npm run typecheck` — pass.
- `npm run build` — pass; bundle budgets enforced.
- `API_TEST_ENABLED=false npm run test:ci` — 109 files passed, 2 integration
  files intentionally skipped; 1,830 passed / 13 skipped tests. Coverage:
  90.02% statements, 82.13% branches, 92.29% functions, 92.01% lines.
- Configured staging integration tests with network access — 2 files / 13 tests
  passed.
- `npm audit --omit=dev --audit-level=moderate` — zero vulnerabilities.
- `npm audit --audit-level=moderate` — zero vulnerabilities.
- Android `./gradlew testDebugUnitTest lintDebug assembleDebug
assembleDebugAndroidTest` — pass, 1,200 tasks; no tracked native drift.
- iOS `xcodebuild -project ios/App/App.xcodeproj -scheme App -destination
'platform=iOS Simulator,id=5B3096E9-8E15-4699-958A-BA72C99D5AD7'
-derivedDataPath /tmp/speleodb-release-audit-ios test` — pass, all 10 native
  tests on an iPhone 17 Pro / iOS 26.4 simulator.
- Hard button scan — zero forbidden matches.
- No `.skip`, `.only`, focused tests, TODO/FIXME/HACK markers, or dirty generated
  native output found.

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
  `API_TEST_ENABLED=false npm run test:ci` (109 files, 1,833 passed, 13 skipped),
  live staging integration (2 files, 13 passed), `npm run quality:inventory`,
  runtime/full `npm audit`, and the hard button scan passed. The full suite also
  includes the MapLibre source-injection contracts.
- **Limitations:** native projects and generated assets are unchanged, so native
  compilation is deferred to the final cross-platform gate. Physical-device
  evidence remains an explicit RR-008 release gate.

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
  hard button scan, and live staging integration (2 files, 13 tests) passed.
  The deterministic covered suite passed 109 files / 1,841 tests with 13 tests
  skipped only because staging was disabled for that command. MapLibre contract
  tests are included in that suite.
- **Design/performance:** one generation-scoped cancellation context is shared
  by admitted user operations. It adds constant-time tracking and signal
  forwarding, no polling or extra requests. Invalidated offline queues suppress
  stale callbacks.
- **Limitations:** native source and generated projects are unchanged; native
  compilation remains in the final cross-platform gate. Physical-device logout
  races remain an explicit RR-008 release protocol.
