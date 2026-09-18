# Adversarial review: dd038b6 through 39b2751

## Scope and corrective plan

Review the inclusive range from `dd038b69a7781e8083191aa4803930fab87fd92a`
through `39b2751`: offline scheduling test synchronization, Android WebView
admission/recovery, privacy-preserving error diagnostics, and iOS 16.4
admission. The implementation agent owns focused fixes; the primary agent owns
integrated verification, full tests, `prek run -a`, and final commits.

- [x] Reproduce diagnostic frame loss through the installed Sentry Capacitor
      rewrite integration; retain its hostless `app:///assets/` locations while
      rejecting non-bundled/private paths.
- [x] Reproduce the error boundary's secondary crash on null/undefined thrown
      values; keep the recovery UI and diagnostic capture operational.
- [x] Audit remaining changes, including provider-specific native admission,
      against actual dependency behavior. Only promote evidenced defects.
- [x] Run focused regressions and update the affected diagnostic documentation.
- [x] Complete repository lint/types/build, full coverage, browser/native gates,
      and `prek run -a`; inspect final diffs and commit explicit owned paths.

## Plan challenge

The old monitoring tests replaced both SDK modules and manually supplied frames
in their original form. They could not detect transformations performed before
`beforeSend`. The regression must run the actual installed Capacitor rewrite
integration and a real SDK stack parser. Broadening the location allowlist is
limited to the SDK's hostless app scheme; arbitrary file paths and payload
fields remain excluded. No dependency change or general telemetry expansion is
required.

React can catch arbitrary thrown values. Logging their stack must not throw a
second error inside the sole recovery boundary. Exercise mounted React behavior
rather than invoking a lifecycle method directly.

## Review and verification

Two actionable defects were reproduced before production changes:

1. **P2 — Sentry drops the original frames after SDK rewriting.**
   `src/utils/errorDiagnostics.ts:114` rejected `app:///assets/…` because its
   scheme pattern required a nonempty authority. The installed Capacitor
   `RewriteFrames` integration produces exactly that form from our sanitized
   relative stacks and from native iOS stacks. Both real-SDK regression cases
   initially emitted an empty frames array. The smallest correction accepts only
   that additional bundled-location form. Four pipeline cases now cover manual
   and automatic SDK capture on Android/iOS-style origins; private paths and URL
   payloads still fail the allowlist.
2. **P2 — Error reporting can crash the recovery boundary.**
   `src/monitoring/AppErrorBoundary.tsx:29` dereferenced `.stack` on arbitrary
   caught values. Mounted React tests throwing `null` and `undefined` both
   failed with a secondary TypeError in `componentDidCatch`, destroying the
   recovery UI. Reading stacks only from Error instances preserves the UI and
   reports the original thrown value.

The corrective plan was challenged against the actual SDK call order and
approved by the primary reviewer. No dependency, native admission, or unrelated
product behavior changed. The test scheduling drain and iOS 16.4 deployment
metadata have no additional evidenced defects. Native provider inspection found
that Huawei has a separate package-version gate; absent a tested Huawei device
or authoritative Chromium mapping, this remains an explicit verification
limitation documented in `docs/ci.md`, not a guessed minimum-version change. The
reusable SDK-envelope test rule is captured in
[authoritative-seam-tests](../lessons/authoritative-seam-tests.md).

Focused verification:

- Before fixes: four intentional regression failures (two empty Sentry frame
  arrays and two null/undefined boundary TypeErrors).
- After fixes:
  `npm run test.unit -- --run src/monitoring/sentry.test.ts src/monitoring/AppErrorBoundary.test.tsx src/utils/errorDiagnostics.test.ts src/monitoring/webviewCompatibility.test.ts src/controllers/SpeleoDBController.test.ts`
  passed all five files / 252 tests, with no unexpected console output.
- `npx tsc --noEmit` passed.

Repository-wide verification and commit references are owned by the primary
agent and will be recorded before completion.

Final integrated verification passed: 2,282 JavaScript tests with coverage, 92
browser tests, 22 Android unit tests, six completed Android device tests, 28
signed iOS native tests, both platforms' Debug/Release builds, lint, types,
inventory, and `npx prek run -a`. The interrupted Android emulator run is
explicitly excluded; resource diagnosis, preserved evidence, and successful
verification after cold-starting with more RAM are recorded in
[the integration report](review-dd038b6-verification.md).

Implementation and review commit: `5460510`. Public changelog maintenance is
recorded in the following `[Changelog Update]` commit.
