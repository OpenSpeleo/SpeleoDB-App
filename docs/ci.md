# GitHub CI

This repository's GitHub Actions workflow is intentionally close to the local
developer contract: hooks first, then the complete test suite, then web/native
builds. The workflow lives in `.github/workflows/ci.yml`.

## Stages

1. **Prek Hooks** runs `PREK_HOME="$RUNNER_TEMP/prek" npx prek run -a
   --show-diff-on-failure`, then `git diff --exit-code`. The diff check makes
   hook auto-fixes fail CI instead of silently changing the runner checkout.
2. **Full Vitest Suite** runs `npm run test.unit -- --run --reporter=verbose
   --coverage --no-file-parallelism`. The `--run` flag is required in CI so
   Vitest exits instead of entering watch mode. File-level serialization keeps
   real SpeleoDB integration tests from issuing concurrent password-login
   requests with the same account from a GitHub-hosted runner.
3. **Production Web Build** runs `npm run build` and uploads `dist/` for native
   jobs.
4. **Build Android** downloads `dist/`, runs `npx cap sync android`, and builds
   release APK/AAB artifacts with a temporary CI keystore.
5. **Build iOS** downloads `dist/`, runs `npx cap sync ios`, archives the Xcode
   project, then creates and verifies a temporarily signed IPA.

Pull requests and pushes to `main` run all five stages. Version tags also keep
the release artifact upload path.

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
password login.

Native builds use `SENTRY_DSN_ANDROID` and `SENTRY_DSN_IOS` when the secrets are
available. Pull requests from forks cannot read repository secrets, so CI uses a
non-secret placeholder DSN for native compile verification only. Release builds
from trusted refs should provide the real per-platform DSNs.

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
