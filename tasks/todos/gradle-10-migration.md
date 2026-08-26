# Gradle 10 migration

## Objective

Make the authoritative Android application build ready for Gradle 10 without
mistaking VS Code's standalone imports of Capacitor plugin source directories
for failures of the composite application build.

## Plan

- [x] Establish the supported Gradle, Android Gradle Plugin (AGP), Java, and
      Capacitor version matrix from primary documentation and the installed
      packages.
- [x] Reproduce the application build through `android/gradlew` with all
      warnings enabled; classify each failure or warning by its owning seam.
- [x] Preserve the user's staged Gradle/AGP upgrade and implement only the
      smallest repository-owned changes required by the reproduced build.
- [x] Add or update regression coverage at the configuration seam that owns
      Gradle 10 compatibility.
- [x] Update `docs/android-gradle-warnings.md` with migration intent, ownership
      boundaries, verification strategy, and performance implications.

## Verification gates

- [x] Focused Gradle compatibility tests pass.
- [x] `./gradlew help --warning-mode all --console=plain` configures the root
      Android build successfully and emits no unattributed Gradle deprecation.
- [x] Android unit tests, lint, Debug/Release APKs, Release AAB, and Android
      instrumentation test compilation pass with `--warning-mode all`.
- [x] Web lint, type checking/build, and the complete unit suite with coverage
      pass, or any unrelated/pre-existing failure is recorded precisely.
- [x] Staged and unstaged diffs are inspected; generated native drift and
      unrelated user work are excluded.

## Review

### Result

- Upgraded the staged Android baseline to AGP 9.3.2 and Gradle 9.5.0, the
  supported pair documented by Android Developers.
- Declared Gradle's Foojay toolchain resolver so Capacitor's Java 21 toolchain
  remains reproducible when Gradle 10 removes legacy cache-only provisioning.
- Limited VS Code Gradle discovery to the authoritative `android` root instead
  of importing Capacitor packages under `node_modules` as standalone builds.
- Added clean-checkout regression coverage and documented warning ownership.

### Verification

- `npm run test.unit -- --run quality/gradle-deprecation-audit.test.ts` — pass,
  1 file and 4 tests.
- `cd android && ./gradlew help --warning-mode all --console=plain` — pass; only
  the already attributed generated Capacitor `flatDir` warning remains.
- `cd android && ./gradlew testDebugUnitTest lint assembleDebug assembleRelease bundleRelease assembleDebugAndroidTest --warning-mode all --console=plain`
  — pass, 1,863 tasks.
- `npm run lint` — pass.
- `npm run build` — pass; includes TypeScript validation and the production web
  bundle.
- `npm run test:ci` — pass, 118 files and 1,939 tests; 90.53% statement, 82.19%
  branch, 93.27% function, and 92.67% line coverage.
- `git diff --check` and `git diff --cached --check` — pass.

### Limitations

- Gradle 10 is not released as of August 26, 2026, so readiness is proven with
  Gradle 9.5's complete warning mode rather than an unavailable distribution.
- Physical-device and iOS verification are inapplicable: this changes build
  configuration and editor discovery only, with no application runtime path.

### Commit

This focused task commit; its hash is reported in the final handoff.
