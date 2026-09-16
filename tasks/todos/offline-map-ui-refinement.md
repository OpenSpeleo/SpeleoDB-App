# Offline Maps UI refinement

User requested matching map controls below the layer button, removal of
coordinate entry, and a lighter, simpler interface. Existing offline-area
implementation and all other working-tree changes are retained.

- [x] Put location, layers and downloads in one layout stack with shared
      styling.
- [x] Remove coordinate entry; emphasize map gestures and a compact save sheet.
- [x] Simplify manager typography, secondary actions and explanatory text.
- [x] Update interaction/browser tests to select through the map; verify control
      spacing, popover stacking, small screens and preserved persistence
      behavior.
- [x] Run lint, typecheck/build, focused tests and full coverage/browser suites.
- [x] Update feature documentation and record verification/limitations here.

## Review

The shared control stack prevents positional overlap and gives all three
controls identical geometry and solid fills. Coordinate forms and physical
dimensions are removed. The manager uses a quiet cache footer and compact
labeled icon actions. Selection keeps the name and estimate above adjacent
Cancel and Download/Save buttons, including on 320 × 300 viewports.

Verification:

- `npm run lint`: passed.
- `npm run build` and `npm run typecheck`: passed.
- Focused panel/layer/Dashboard suite: 136 passed; panel suite after the final
  action-layout/resize change: 17 passed.
- `npm run test:ci`: 1,989 tests across 122 files passed. Coverage: statements
  90.68%, branches 82.69%, functions 92.93%, lines 92.85%.
- `git diff --check` and `git diff --cached --check`: passed; existing staging
  was preserved. No commit created.
- `npm run test:browser`: 32 passed in Chromium/WebKit, without retries.
  Screenshots inspected at 320 × 568 and 320 × 300; controls and actions are
  visible and reachable. Tests verify shared control dimensions, safe-area
  spacing, layer-menu hit testing, cancel/discard/reopen, all corner targets,
  offline persistence, refinement, visibility and deletion.

Native source, bridge, storage and download lifetime code are unchanged in this
refinement. Native compilation/unit suites are not repeated for this JSX/CSS
change; their feature-level evidence is recorded in offline-download-areas.md.
Chromium/WebKit rendering and real input-handler checks cover this change's
owning seam. Physical iOS/Android touch verification remains a release gate;
browser emulation is not physical-device evidence.

Reusable correction:
[shared map controls and reachable sheet actions](../lessons/map-control-layout.md).

Follow-up: Cancel belongs beside Download/Save in the bottom selection sheet,
with a 44-pixel target. The top of the map is guidance only. Browser checks tap
Cancel and resume editing at portrait, landscape and keyboard-sized viewports.

The short WebKit viewport exposed a collapsed-frame bug when refitting an
oversized draft after reopening selection. Resize now preserves downloadable
geometry and resamples oversized drafts through the normal frame. A component
regression asserts that no impossible fit occurs and the corner frame stays 72
pixels high on a 300-pixel map. Browser coverage also cancels and reopens
selection before testing every corner's touch target.
