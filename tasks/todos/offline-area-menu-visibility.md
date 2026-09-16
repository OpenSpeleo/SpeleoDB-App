# Offline area visibility follows the menu

## Plan and verification gates

- [x] Remove per-area show/hide controls and unused eye icons.
- [x] Derive map rectangles from the active Offline Maps panel (including its
      editor); closing, changing panels, or leaving Dashboard hides all
      rectangles.
- [x] Show every manual area while open, including previously hidden entries.
      Keep legacy persisted visibility data compatible; do not mutate the
      catalog or trigger downloads when the menu opens or closes.
- [x] Cover panel actions, legacy hidden areas, and Dashboard open/close/editor
      transitions at the actual map-source seam; update browser expectations.
- [x] Update feature documentation; run focused tests, full coverage, browser
      tests, lint, typecheck and build.

## Review

The navigation state already owns menu visibility. Reuse it instead of adding
another persisted switch. Automatic source-owned areas remain outside the manual
area manager and its presentation. Geometry planning/storage are unchanged.
Native code and device lifecycle behavior are unaffected; browser rendering and
component map-source tests are the relevant automated seams. No native or
physical device checks were run for this presentation-only change.

- Focused manager, Dashboard, map layers and geometry tests: 147 passed.
- `npm run test:ci`: 2,016 tests in 122 files passed. Coverage: statements
  90.43%, branches 82.90%, functions 92.70%, lines 92.57%. Two obsolete toggle
  tests were removed; Dashboard menu visibility has a new integration test.
- `npm run test:browser`: 36 Chromium/WebKit checks passed without retries;
  inspected the WebKit manager screenshot showing only Edit/Delete actions.
- `npm run lint` and `npm run build` (including TypeScript validation): passed.
  Initial validation caught test-fixture typing and an unsupported test query
  option; both were corrected before the successful build.
- `git diff --check`: passed. Documentation formatted with Prettier.
- Changes remain uncommitted for review; baseline is `9600209`.
