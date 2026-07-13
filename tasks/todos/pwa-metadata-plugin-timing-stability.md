# PWA Metadata Build-Log Stability

## Goal

Keep the metadata artifact test deterministic when Rolldown's heuristic plugin
timing advisory fires. Suppress only that advisory inside the metadata-only
in-process build; production builds retain the diagnostic.

## Plan

- [x] Record the existing full-suite failure as the red test evidence.
- [x] Disable Rolldown `pluginTimings` checks only in the PWA test build.
- [x] Run the focused metadata test repeatedly.
- [x] Run lint, typecheck, build, and the complete coverage suite.
- [x] Update the planner task review with the restored green result.
- [x] Inspect, commit independently as `[Test]`, verify, and confirm clean
      status.

## Review

The full suite's console guard rejected Rolldown's `PLUGIN_TIMINGS` warning from
the PWA metadata test's in-process build. Whether the warning appears depends on
machine load, so the same product tree had both green and red full-suite runs.
The test already uses Vite's silent log level, but this Rolldown diagnostic
bypasses it.

The metadata-only build now sets `build.rolldownOptions.checks.pluginTimings` to
`false`. It does not benchmark build plugins, and standalone production builds
retain the diagnostic. No general console suppression or relaxed assertion was
added.

Verification:

- Red: the full suite executed 1,924 passing tests and failed only when the
  console guard observed `PLUGIN_TIMINGS` in the PWA metadata test.
- Three concurrent `npx vitest run quality/pwa-metadata.test.ts` invocations
  passed 2/2 tests each under deliberate load.
- `npm run lint`, `npm run typecheck`, and `npm run build` passed.
- `API_TEST_ENABLED=false npm run test:ci` passed 117 files / 1,925 tests, with
  2 configured files and 13 staging-only tests skipped. Coverage was 90.42%
  statements, 82.02% branches, 92.95% functions, and 92.52% lines.
- `git diff --check` passed. This test-only change requires no native build or
  physical-device evidence.
