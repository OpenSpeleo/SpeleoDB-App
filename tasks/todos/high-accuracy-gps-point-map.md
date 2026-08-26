# High-Accuracy GPS Point Map Regression

## Goal

Ensure a landmark saved from the High-Accuracy GPS Point flow is immediately
published to the dashboard landmark map source when the create is queued as a
pending offline operation.

## Plan

- [x] Reproduce the report at the MapLibre paint-expression seam using the exact
      blank-color personal-landmark payload emitted by the real queue fold.
- [x] Identify and fix the smallest production owner that loses or hides the
      queued landmark between durable enqueue and map-source publication.
- [x] Add focused regression coverage for the authoritative queued-create fold
      and production map paint expression.
- [x] Update the GPS/landmark architecture docs if the fix clarifies or changes
      an ownership invariant.
- [x] Run focused tests, lint/type/build validation, the complete unit suite
      with coverage, and applicable coding-rule checks.

## Verification Gates

- [x] RED evidence: the new regression test fails on the pre-fix behavior for
      the reported reason.
- [x] Focused map/dashboard/controller tests pass after the fix.
- [x] `npm run lint` passes.
- [x] `npm run typecheck` and `npm run build` pass.
- [x] `npm run test:ci` passes.
- [x] `rg 'app-btn[^\"]*bg-' src --glob '*.tsx'` returns no matches.

## Review

### Root cause and result

Offline creates in the personal landmark collection intentionally carry
`collection_color: ''` until replay assigns the server-owned collection. The
landmark marker/label paint used `coalesce`, which treats an empty string as a
present value. MapLibre therefore attempted to parse an invalid paint color; the
pending operation and folded feature existed, but the symbol could be absent in
the Android renderer.

The shared marker/label expression now uses MapLibre `to-color` with
`COLORS.FALLBACK`. It preserves valid collection colors and resolves blank or
malformed values to a renderable color. Because the repair is in the paint
expression, it also covers pending operations persisted by older app versions.

Regression evidence covers both ends of the contract: the real controller queue
fold produces the blank-color optimistic personal landmark, and the production
map paint expression compiles/evaluates that exact shape to the fallback color.

### Verification

- RED:
  `npm run test.unit -- --run src/pages/dashboard/DashboardMapLayers.test.tsx --no-file-parallelism`
  failed with `Could not parse color from value ''` before the fix.
- Focused:
  `npm run test.unit -- --run src/pages/dashboard/DashboardMapLayers.test.tsx src/pages/Dashboard.test.tsx src/controllers/SpeleoDBController.test.ts --no-file-parallelism`
  passed (3 files, 320 tests).
- `npm run lint` passed.
- `npm run typecheck` passed.
- `npm run build` passed.
- `npm run test:ci` passed (118 files, 1,936 tests; 90.53% statements, 82.19%
  branches, 93.27% functions, 92.67% lines).
- `npm run quality:inventory` passed for all 604 tracked files.
- `rg 'app-btn[^\"]*bg-' src --glob '*.tsx'` returned no matches.
- `git diff --check` passed.

Native unit/build layers are inapplicable because no Capacitor or native source
changed. Physical-device verification was not run; the regression instead uses
MapLibre's production style-expression engine to prove the formerly invalid
Android-facing paint value is now valid. The expression adds no network,
storage, or per-feature application work beyond MapLibre's existing paint
evaluation. No commit was created.
