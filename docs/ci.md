# GitHub CI

This repository's GitHub Actions workflow is intentionally close to the local
developer contract: hooks first, then the complete test suite, then web/native
builds. The workflow lives in `.github/workflows/ci.yml`.

## Stages

1. **Prek Hooks** runs
   `PREK_HOME="$RUNNER_TEMP/prek" npx prek run -a --show-diff-on-failure`, then
   `git diff --exit-code`. The diff check makes hook auto-fixes fail CI instead
   of silently changing the runner checkout.
2. **Full Vitest Suite** runs
   `npm run test.unit -- --run --reporter=verbose --coverage --no-file-parallelism`.
   The `--run` flag is required in CI so Vitest exits instead of entering watch
   mode. File-level serialization keeps real SpeleoDB integration tests from
   issuing concurrent password-login requests with the same account from a
   GitHub-hosted runner.
3. **Production Web Build** runs `npm run build` and uploads `dist/` for native
   jobs.
4. **Android Release Compile Smoke** downloads `dist/`, runs
   `npx cap sync android`, and builds release-configuration APK/AAB files with a
   disposable CI keystore.
5. **iOS Release Compile Smoke** downloads `dist/`, runs `npx cap sync ios`,
   archives the Xcode project, then verifies an IPA signed by a disposable CI
   identity.

Pull requests and pushes to `master` run all five stages. Version tags retain
the explicitly named `*-ci-smoke-*` workflow artifacts for seven days. They are
compile evidence only and are never attached to a GitHub release.

## Default Branch Contract

`master` is the repository-owned default branch. The workflow's push filter and
its concurrency exception must change together: pushes to the default branch run
CI, and an in-progress default-branch run is preserved while superseded
feature-branch runs may be cancelled. Pull-request targeting remains independent
and accepts every branch.

## Release Integrity

Disposable CI credentials prove that release configurations compile and that the
resulting bundles can be structurally signed. They do not establish publisher
identity, store eligibility, update compatibility, entitlements, or installation
on a target device. Accordingly:

- this CI workflow has no `contents: write` permission and never creates a
  GitHub release;
- smoke artifacts are named `android-ci-smoke-*` and `ios-ci-smoke-*`;
- smoke artifacts must never be distributed to users or submitted to stores;
- a future publishing workflow must use protected trusted-signing credentials,
  verify the expected certificate/team identity, install the exact artifacts,
  validate symbols/mappings, and require the physical-device release checklist.

The authorized trusted-signing, artifact, installation, store-validation,
approval, and rollback protocol is defined in `docs/release-ceremony.md`. It is
a manual authorization boundary; this CI workflow does not implement publishing.

## Vitest Wrapper

All CI Vitest invocations must go through `npm run test.unit`, which calls
`scripts/run-vitest.sh`. The wrapper sanitizes locally injected Node web-storage
flags, forces the threaded Vitest pool unless the caller chooses another pool,
and only passes a web-storage disable flag when the current Node binary supports
it. This avoids the Node 22 failure mode:

```text
node: bad option: --no-webstorage
```

Do not call bare `npx vitest` from CI unless the wrapper behavior is also
preserved.

## Coverage Enforcement

The covered suite is a blocking gate, not a report-only artifact.
`vite.config.ts` sets audited July 2026 global floors of 90% statements, 82%
branches, 92% functions, and 92% lines. Critical ownership seams also have
file-specific floors so the global aggregate cannot hide regression in session
authority, GPS recording transitions, offline replay, or IndexedDB transaction
handling:

- `SessionCoordinator.ts`: 100% for all four metrics;
- `GpsRecordingCoordinator.ts`: 97% statements, 91% branches, 100% functions and
  lines;
- `OfflineOpQueue.ts`: 82% statements, 65% branches, 93% functions, 83% lines;
- `CacheStore.ts`: 81% statements, 69% branches, 88% functions, 81% lines.

These are fixed non-regression floors (`autoUpdate: false`), not aspirational
targets. Raise them only with behavior-owning tests and an audited full-suite
result. Do not lower them to make CI green and do not add file exclusions to
hide a regression.

No application module was excluded for this gate. Vitest's normal runtime
instrumentation does not treat test files, declarations, native source, static
assets, or build tooling as shipped browser modules; those non-runtime artifacts
remain covered by their own typecheck, native, asset, and tooling gates. The
staged path toward 100%-per-file remains: require 100% for new/refactored leaf
modules where practical, close historical branch gaps with production-seam
tests, raise each critical floor as evidence improves, and enable repository
`perFile` enforcement only when the remaining historical modules meet it.

`quality/coverage-thresholds.test.ts` protects the configuration contract. The
authoritative proof is still the full `npm run test:ci` command: Vitest exits
non-zero when either a global or file-specific floor is missed.

## Release Behavior Documentation

Release instructions are executable contracts where a stale expectation can
invalidate otherwise-correct device evidence. The covered suite therefore runs
`quality/release-documentation-contract.test.ts`, which keeps the native GPS
checklist and deep-link documentation aligned with five tested runtime rules:

- reconnect refreshes state but queue replay is explicit from Pending;
- Android notification denial does not block recording;
- deep-link diagnostics never contain the received URL or query payload;
- voluntary pending-operation deletion requires acknowledgement, while forced
  credential-invalidating logout is non-interactive;
- GPS save success is published only after durable persistence.

This contract detects contradictory instructions; it is not a substitute for the
owning component, coordinator, fake-IndexedDB, native, or physical-device tests.
`GPS_NATIVE_RELEASE_CHECKLIST.md` defines that evidence boundary and requires
device/build identity for each manual result.

## Secrets

Integration tests are opt-in. They run only when `API_TEST_ENABLED=true` and all
required SpeleoDB credentials are present:

- `SPELEODB_INSTANCE_URL`
- `SPELEODB_OAUTH_TOKEN`
- `SPELEODB_EMAIL`
- `SPELEODB_PASSWORD`

The password-login endpoint can return `403` from GitHub-hosted runners even
when the same credentials work locally. When that happens, integration tests
accept the runner-side password-auth block only after validating
`SPELEODB_OAUTH_TOKEN` against the same instance. Local runs remain strict for
password login. The live tests use the production `HttpClient` transport, whose
Node-backed API requests identify as `SpeleoDB-Web`; do not substitute a
test-only user agent because production edge security may challenge it before
the request reaches SpeleoDB.

Native compile-smoke builds use `SENTRY_DSN_ANDROID` and `SENTRY_DSN_IOS` when
the secrets are available. Pull requests from forks cannot read repository
secrets, so CI uses a non-secret placeholder DSN. This workflow does not produce
trusted releases, regardless of whether real DSNs are present.

## Local Verification

Before changing CI-sensitive code, run the same core commands locally:

```bash
node --version # must be Node 22
make ci
PREK_HOME=/private/tmp/prek npx prek run -a --show-diff-on-failure
```

`make ci` verifies the tracked-file quality inventory, lint, type checking, the
full one-shot Vitest suite with coverage and serialized test files, and the
production web build. Run Android Gradle and iOS `xcodebuild` locally when
changing native configuration or platform-facing behavior. `make sync` updates
both native projects; inspect every tracked Android/iOS diff after it runs.
