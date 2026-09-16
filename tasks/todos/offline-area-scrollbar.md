# Offline-area spacing and persistent scrollbar

- [x] Add 8 px below Add and increase the manager height cap by 10%, preserving
      fixed controls and the viewport limit.
- [x] Render a persistent scroll-position indicator whenever rows overflow,
      independent of platform scrollbars that fade while idle. Keep native
      scrolling.
- [x] Verify overflow/no-overflow, thumb position, content/viewport resizing and
      listener cleanup; extend real-browser long-list checks and inspect
      screenshots.
- [x] Document behavior and run focused tests, full coverage, browser checks,
      lint and TypeScript/build validation.

## Review

Preserve existing work and the editor layout. A small list component can measure
its viewport/content with ResizeObserver and update the indicator directly on
native scroll, without rerendering rows or changing download state.

- Added an 8 px gap; increased caps by 10% to 42.24%/42.9% and the short-screen
  floor to 242 px, always bounded by the viewport.
- Focused list, manager and Dashboard tests: 139 passed. Covers overflow,
  resizing, content shrink, scroll position, overscroll and listener cleanup.
- `npm run test:ci`: 2,023 tests across 123 files passed. Coverage: statements
  90.47%, branches 82.96%, functions 92.71%, lines 92.60%.
- `npm run test:browser -- --config=/tmp/offline-scroll-playwright.config.ts`:
  38 Chromium/WebKit checks passed without retries. Temporary external config
  isolates port/output from concurrent browser work. Reviewed the WebKit
  screenshot.
- `npm run build` and `npm run typecheck`: passed.
- `npm run lint -- --ignore-pattern 'test-results/**'`: passed; excludes
  generated browser output only. An earlier pass caught temporary camera-debug
  typing in unrelated concurrent work, since removed.
- `git diff --check`: passed. No native code or background behavior changed; no
  physical-device verification claimed. Browser tests verify rendering and
  component tests verify observer/listener lifetime.
- Existing work preserved. No commit requested or created.
