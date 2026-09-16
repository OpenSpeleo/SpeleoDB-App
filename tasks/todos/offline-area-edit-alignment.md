# Offline area editor alignment

User reports that opening Edit moves the viewport and offsets the editing frame
from the saved zone (root screenshot 2026-09-16 14.46.36).

- [x] Reproduce boundary drift at the real map/viewport seam before fixing it.
- [x] Synchronize MapLibre dimensions before fitting/projecting selection
      frames; distinguish user map gestures from layout/programmatic camera
      changes.
- [x] Preserve exact bounds on Edit → Save and layout/rotation; verify actual
      user pan/zoom and corner refinement still change the selected area.
- [x] Run focused tests, lint/typecheck/build, full coverage and browser checks.
- [x] Update feature docs, capture the reusable lifecycle lesson, and record
      commands/results/physical-device limits.

The task preserves existing staged work and both user screenshots. Authorization
is the user's bug report; this is a correction to the existing editing flow.

## Review

Root cause: editor activation hid the tab bar in a later effect. The editor's
ResizeObserver then used new DOM dimensions with an older MapLibre transform;
MapLibre's own delayed resize emitted non-user `move` events that overwrote the
draft. This shifted the saved rectangle, not just its visual handles.

The real browser regression failed before the fix in both engines: Edit → Save
changed latitude and advanced revision 1 to 2. It now compares exact persisted
records across repeated editing and portrait/landscape rotation, then verifies
that a deliberate corner edit changes only the expected edge.

The fix batches editor/chrome activation, measures in a layout effect,
synchronizes MapLibre dimensions before fitting, and reprojects geographic draft
bounds for programmatic movement. Only original user input or corner actions
changes intent. The frame also clears the measured safe-area heading; its CSS
falls back to native safe-area environment values. Both observer callback
orderings have component regressions, including synthetic move events and no
pixel-to-coordinate round trip.

Verification:

- Before fix:
  `npm run test:browser -- tests/browser/offline-maps.spec.ts --grep 'editing and resizing'`:
  failed in both Chromium and WebKit (boundary drift).
- Focused panel/Dashboard tests: 130 passed.
- `npm run lint`, `npm run typecheck`, `npm run build`: passed.
- `npm run test:ci`: 1,993 tests across 122 files passed. Coverage: statements
  90.69%, branches 82.78%, functions 92.91%, lines 92.86%.
- `npm run test:browser`: all 34 Chromium/WebKit checks passed without retries.
- `git diff --check` and `git diff --cached --check`: passed.
- One lint invocation overlapped Playwright artifact deletion and hit ENOENT;
  the final lint run after browser completion passed. No assertions were
  relaxed.
- Inspected WebKit screenshot: handles match the saved striped rectangle.
- Existing staged work and both screenshots remain intact; no commit created.

No native bridge or download/storage implementation changed. The authoritative
checks run actual MapLibre and browser IndexedDB, plus both observer orderings
in component tests. Physical iOS retesting is still needed; the supplied
screenshot is pre-fix evidence, not proof of post-fix device behavior. Native
compilation and native unit tests do not exercise this JavaScript resize race
and were not rerun.

Reusable lesson:
[map layout and geographic intent](../lessons/map-control-layout.md).
