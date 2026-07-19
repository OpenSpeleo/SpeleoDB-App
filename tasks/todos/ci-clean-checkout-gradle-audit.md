# CI clean-checkout Gradle audit

## Goal

Make the blocking Vitest quality suite deterministic in a fresh checkout while
preserving ownership of Capacitor-generated Android warnings in the native build
gate.

## Plan

- [x] Confirm the failing file is ignored generated output and identify which CI
      job creates it.
- [x] Keep the unit quality audit at committed and installed dependency seams;
      do not generate or mutate native projects during Vitest.
- [x] Run the focused audit with the ignored generated file absent.
- [x] Run lint, the complete quality directory, and diff checks.
- [x] Record results and any external limitation.

## Review

- Root cause: `quality/gradle-deprecation-audit.test.ts` read
  `android/capacitor-cordova-android-plugins/build.gradle`, but that path is
  ignored and is created only by `npx cap sync android` in the later Android CI
  job. A developer's stale generated checkout hid the missing prerequisite.
- Resolution: the unit quality test now validates the installed plugin patches
  and the committed warning ledger. The Android build job remains responsible
  for inspecting generated Cordova output after Capacitor sync.
- Focused clean-checkout simulation: with the generated `build.gradle`
  temporarily absent, the audit passed 2/2 and the file was restored afterward.
- `npm run test.unit -- --run quality --reporter=dot --no-file-parallelism`:
  passed 6 files / 18 tests.
- `npm run lint`: passed.
- `npm run test.unit -- --run --reporter=dot --coverage --no-file-parallelism`:
  passed 117 files / 1,926 tests; 2 integration files / 13 tests were skipped
  because this checkout has no mobile `.env`.
- `npm run build`: passed.
- Focused Prettier check and `git diff --check`: passed.
- External limitation: the attached CI run also received two 10-second token
  validation stalls and one HTTP 502 from the deployed service. The public
  invalid-token endpoint later returned the expected HTTP 403 in 0.289 seconds.
  No retry, skip, relaxed assertion, or application transport change was added;
  configured-token validation still needs the credentialed CI rerun.
- Reusable rule: see `tasks/lessons/ci-generated-artifact-prerequisites.md`.
