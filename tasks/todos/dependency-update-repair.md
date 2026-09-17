# Repair `make update`

## Plan and verification gates

- [x] Inspect the failed manifest, lockfile, npm report, and routing API usage.
      Ionic Router 8 requires Router 5; Ionic Router 9 requires Router 6. The
      app uses `useHistory` and History 4 throughout production and integration
      tests.
- [x] Restore the six routing-related requirements to their supported majors;
      preserve other updates already requested in the working tree.
- [x] Limit routine `make update` to minor/patch releases with peer checks.
      Exercise the real Make target with fake package-manager executables to
      prove options, ordering, failure propagation, and phony-target behavior.
- [x] Document update policy and separate major-version migration ownership.
- [x] Adapt the tile-cache runtime test fixture to Vitest 5 clearing mock call
      history: capture its once-registered protocol in `beforeAll`, preserving
      all runtime assertions and the runner's default isolation behavior. This
      is a diagnosed compatibility issue in the retained Vitest update, not a
      cache bug.
- [x] Compare production bundle-budget failure against an isolated committed
      baseline before deciding whether dependency or application changes are
      needed.
- [x] Restore React/React DOM 19.2.8 and make their updater pass patch-only. The
      isolated baseline entry was 443.06 KB; all updates except React 19.3
      produced 443.07 KB. React 19.3 produced 461.5 KiB, over the 450,000-byte
      gate.
- [x] Verify real installation and lockfile consistency, focused routing/tooling
      tests, lint, typecheck, complete coverage suite, and production build.
- [x] Review all diffs and record results and remaining evidence boundaries.

## Review

### Evidence collected

- `make update`: passes with peer checks enabled, minor updates for ordinary
  packages and patch updates for React/React DOM. Both registry passes retain
  the intended versions; Sentry remains constrained by its Capacitor peer.
- `npm ci` and `npm ls --all`: pass. Clean installation emits no Vitest peer
  override warning; Vitest and its coverage provider both resolve to 5.0.1.
- Initial focused routing/tooling run: 27 tests passed. The Make regression
  originally failed against the old target, which was not phony.
- Vitest 5 initially failed six tile-cache tests because it clears mock history.
  Capturing the singleton protocol in `beforeAll` makes all seven tile-cache
  tests pass without altering production code or weakening assertions.
- Final
  `PATH=/Users/jonathan/.local/share/mise/installs/node/22.23.2/bin:$PATH make ci`:
  inventory, lint, typecheck, coverage, and production build all pass. The suite
  has 124 files and 2,028 passing tests, with coverage 90.46% statements, 82.96%
  branches, 92.71% functions, 92.60% lines. Final production entry is 443.07 KB,
  below 450 KB.
- Build diagnosis used an isolated `git archive HEAD` checkout, not
  modifications to the user's index. Baseline entry: 443.06 KB. All other
  updates with React 19.2.8: 443.07 KB. React 19.3: 461.5 KiB, over 439.5 KiB
  (450,000 bytes).
- `npm audit --json`: three moderate findings in one development-only chain,
  `@capacitor/cli -> xcode -> uuid`. npm proposes CLI 8.4.3 as a downgrade. No
  forced audit fix, transitive major override, or dependency substitution.
  `npm audit --omit=dev`: zero vulnerabilities.
- `npx cap sync`: passes for Android, iOS, and web, including web-asset copying.
  Reviewed generated native diffs: only the iOS Swift package requirement and
  resolution change from Capacitor 8.5.0 to 8.5.2.
- `cd android && ./gradlew testDebugUnitTest lintDebug assembleDebug --console=plain`:
  passes after the React correction (755 tasks). The app's three test classes
  report 14 tests, zero failures/errors/skips. The earlier attempt failed solely
  at the React 19.3 web-entry budget.
- Browser prerequisite: the Playwright update required new executable binaries.
  Installed them with `npx playwright install chromium webkit`; initial browser
  failures were missing executables, before application tests could execute.
- `xcodebuild -project ios/App/App.xcodeproj -scheme SpeleoDB -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/speleodb-dependency-update-ios-build CODE_SIGNING_ALLOWED=NO build`:
  passes with Capacitor 8.5.2. The initial `App` scheme from the existing
  Makefile does not exist; `xcodebuild -list` identifies the actual `SpeleoDB`
  scheme.
- `PREK_HOME=/private/tmp/prek npx prek run --files` with all nine changed/new
  task paths: all applicable hooks pass, including formatting, lockfile sync,
  ESLint, typecheck, and production build.
- First browser run with installed executables: 37/38 passed. The remaining
  WebKit navigation received a 404 at `2026-09-17T00:28:29.303Z`, while the
  concurrently launched build hook rewrote `dist/index.html` at `00:28:29.443Z`.
  This was a verification orchestration error. All output writers were stopped
  before repeating the suite, with no retries or changed assertions. Preventive
  rule: [stable preview assets](../lessons/browser-preview-build-ownership.md).
- Final serialized
  `PATH=/Users/jonathan/.local/share/mise/installs/node/22.23.2/bin:$PATH npm run test:browser`:
  all 38 Chromium/WebKit tests pass in 50.8 seconds.
- `git diff --check` and `git diff --cached --check`: pass. Reviewed both the
  user's staged dependency changes and the additional unstaged repairs.

### Remaining verification and boundaries

All installation, web, browser, Android unit/lint/build, and iOS simulator
compile checks listed above pass. No iOS XCTest, device instrumentation, or
physical-device evidence has been collected; installation/build success cannot
certify compass or Capacitor device behavior. Runtime native source is
unchanged; the retained Capacitor and compass dependency updates still require
the normal device release checklist before distribution. No commit requested or
created. The user staged manifest/Makefile changes while work was underway;
their index was left untouched by this task.
