# Offline area zoom

- [x] Inspect project/GPS camera actions, offline area geometry, and existing
      work.
- [x] Check in with the implementation plan before editing production code.
- [x] Share the project/GPS bounds camera action and reuse it from an accessible
      offline-area row action; keep the menu open on selection.
- [x] Verify ordinary/dateline bounds, keyboard activation, and edit/delete
      isolation at the mounted UI seam.
- [x] Document intent, ownership, performance, and verification under `docs/`.
- [x] Run focused tests, lint, typecheck/build, full tests with coverage, and
      relevant browser tests; inspect final diffs.

## Flat-row correction

- [x] Restore the original compact row presentation and extend its native button
      hit target across the row; keep edit/delete above that target.
- [x] Verify the rendered row height, lack of a card, whole-row tap, and
      keyboard/edit/delete behavior; rerun applicable checks.
- Prevention:
  [preserve layout when adding an interaction](../lessons/interaction-changes-preserve-layout.md).

Correction verification: `npm run lint` and `npm run build` passed;
`npm run test:browser -- tests/browser/offline-maps.spec.ts` passed all 16 tests
across Chromium and WebKit. The browser regression now checks the original 68 px
row height, transparent background, no border/padding on the label button, and
selection by tapping the row padding outside the label's layout box. Reviewed
the new WebKit screenshot: original flat compact rows restored.
`npm run test:ci` passed again: 122 files and 2,021 tests with coverage,
including keyboard activation and edit/delete isolation.

## Keep-menu-open correction

- [x] Remove the selection-triggered close callback; preserve the existing zoom
      helper and flat rows.
- [x] Verify the menu and area outlines remain visible after zoom, including
      keyboard use and consecutive selections; run lint/build, coverage, and
      browser checks.

`npm run lint` and `npm run build` passed.
`npm run test:browser -- tests/browser/offline-maps.spec.ts` passed all 18 tests
across Chromium and WebKit, including consecutive area taps without reopening
the menu. The initial coverage run was interrupted because another process
removed the shared `coverage/.tmp` directory (Vitest reported ENOENT). Rerunning
with
`npm run test:ci -- --coverage.reportsDirectory=/tmp/speleodb-area-open-coverage`
isolates generated output; no test retries or assertions were changed. The
isolated run passed all 122 files and 2,021 tests with coverage. Staged and
unstaged whitespace checks passed. No native behavior changed; no device testing
claimed.

## Fit above the open menu

- [x] Extend the shared zoom helper to fit above an optional measured panel,
      keeping project/GPS defaults unchanged.
- [x] Measure the current map/panel rectangles on each selection; adapt margins
      for short viewports and keep the menu open.
- [x] Cover panel height/viewport changes and dateline bounds at the mounted UI
      seam, inspect browser rendering, and run lint/build, focused tests,
      coverage and browser checks.
- [x] Update feature documentation and record verification evidence.

Verification for fitting above the menu:

- `npm run test.unit -- --run src/components/map/OfflineMapsPanel.test.tsx src/pages/Dashboard.test.tsx src/pages/dashboard/useDashboardProjectVisibility.test.ts src/pages/dashboard/useDashboardGpsTrackActions.test.tsx`:
  161 tests across 4 files passed.
- `npm run lint` and `npm run build`: passed.
- `npm run test:ci -- --coverage.reportsDirectory=/tmp/speleodb-area-above-coverage`:
  2,022 tests across 122 files passed, with coverage. Isolated output avoids
  collisions with concurrent workspace checks.
- `npm run test:browser -- tests/browser/offline-maps.spec.ts`: 18 tests passed
  across Chromium/WebKit. Browser cases now exercise selection after
  portrait/landscape resizing.
- Inspected portrait screenshots: complete area above the menu. Temporary
  browser diagnostics also checked the actual projected corners in short
  landscape: y=8.75–26.25 with menu top=35, and y=3.25–9.75 with menu top=13
  after concurrent sheet-size changes. Both stay wholly above the menu. The
  latter is necessarily small because only 13 px remain visible.
- Removed temporary camera diagnostics. The initial diagnostic probe failed on
  an internal source-data shape; replacing it with persisted area corners
  confirmed the camera result. No production workaround or relaxed assertion was
  needed.
- Staged and unstaged whitespace checks passed. No commit created, no native
  APIs changed, and no physical-device evidence claimed.

## Review

Preserved existing uncommitted work. No commit requested or created by this
task.

- `npm run test.unit -- --run src/components/map/OfflineMapsPanel.test.tsx src/pages/Dashboard.test.tsx src/pages/dashboard/useDashboardProjectVisibility.test.ts src/pages/dashboard/useDashboardGpsTrackActions.test.tsx src/services/downloadAreaGeometry.test.ts`:
  5 files, 174 tests passed.
- `npm run lint`: passed.
- `npm run build`: TypeScript and production build passed.
- `npm run test:ci`: 122 files, 2,021 tests passed with coverage (90.44%
  statements, 82.93% branches, 92.70% functions, 92.58% lines).
- `npm run test:browser -- tests/browser/offline-maps.spec.ts`: 16 tests passed
  across Chromium and WebKit, including the real camera zoom and unchanged saved
  catalog after selection.
- Initial screenshot review missed the requested existing-row presentation.
  Superseded by the flat-row correction below.
- `git diff --check` and `git diff --cached --check`: passed; inspected both
  staged and unstaged changes. Button background rule search returned no
  matches.

Native integration and device testing are not required for this shared
React/MapLibre camera action: no native APIs, lifecycle, storage, network, or
background behavior changes. Browser verification covers the rendered
interaction; no physical-device evidence claimed.
