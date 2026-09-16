# Keep offline-area controls stationary

- [x] Give the manager a constrained column layout with a scrollable row list;
      keep the title, close control and Add button outside the scroll region.
- [x] Reduce the manager height cap to 60% of the previous 64%/65% limits
      (38.4%/39% of map height). Retain a small-screen minimum for fixed
      controls and one scrollable row, bounded by the available viewport.
- [x] Add a real-browser regression with many persisted areas, checking fixed
      header geometry, last-row access and deletion confirmation in portrait and
      landscape in Chromium/WebKit.
- [x] Update the feature documentation and run focused tests, full coverage,
      browser checks, lint and TypeScript/build validation.

## Review

The root cause is `overflow: auto` on the shared sheet. Scope the new layout to
the manager so the boundary editor retains its existing layout. Preserve current
row zoom and edit/delete actions. No storage, download, or native-code changes
are needed. Existing staged/unstaged work is outside this correction and remains
intact. No commit requested or created.

- `npm run test.unit -- --run src/components/map/OfflineMapsPanel.test.tsx`: 21
  tests passed.
- `npm run lint`, `npm run build` (including TypeScript): passed.
- The default browser port was occupied by another active test run. Used a
  temporary config outside the repo with port 4174 and an isolated output
  folder; retained the same projects, test directory, worker count and zero
  retries.
- `npm run test:browser -- --config=/tmp/offline-scroll-playwright.config.ts`:
  all 38 tests passed in Chromium/WebKit. Repeated the two long-list checks
  after adding saved screenshots; reviewed the WebKit portrait and short-screen
  images.
- The first full coverage run overlapped with external row-zoom changes: it
  loaded the earlier closing behavior against newer stay-open assertions. Two
  tests failed. The current implementation and matching assertions were left
  intact; a fresh full run verifies the settled files. `npm run test:ci`: 2,021
  tests across 122 files passed, with coverage of 90.44% statements, 82.93%
  branches, 92.70% functions and 92.58% lines. Final lint and explicit typecheck
  also passed.
- `git diff --check`: passed. No physical-device tests run: this change owns
  shared CSS scroll layout, verified through rendered bounds and real browser
  scrolling; it changes no native APIs or background lifecycle.
