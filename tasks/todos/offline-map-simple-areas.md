# Simple offline areas

User authorized removing names and detail/retry screens, adding stable random
colors, direct row actions, multiple areas, and Cancel/Save boundary editing.

- [x] Persist colors for manual areas, preserve them through edits/restarts, and
      safely upgrade existing catalog entries without changing tile ownership.
- [x] Replace area details with one list: colored marker/status, visibility,
      edit, red delete with confirmation. Keep Add new offline area always
      available.
- [x] Remove name entry and use Cancel/Save for new and edited boundaries.
- [x] Render each map area with its assigned color and subtle stripes.
- [x] Prove multiple creation/edit/delete, color stability, legacy settings,
      offline saving and small-screen touch targets at their owning seams.
- [x] Run lint, typecheck/build, focused tests, full coverage and browser
      suites; update docs and record evidence and limits.

## Verification gates

No loss of existing catalog entries or tile pins; distinct color choices until
palette exhaustion; editing one area must retain the others and their colors.
Browser checks must use the shipped controls and real IndexedDB. Preserve
existing staged work and unrelated screenshots. Physical-device evidence is not
available from browser emulation.

## Review

Implemented one list with colored area markers and visibility/edit/delete icons,
no names or detail screen. Add new offline area and Save both return naturally
to the list. Cancel discards only the editor draft, without another dialog.
Delete remains explicitly confirmed. A small status/estimate keeps download
feedback visible without adding actions.

The service owns random color assignment and preserves colors, IDs, list order,
and other areas during edits. A transactional legacy upgrade removes manual
names and assigns colors without altering coverage revisions, generation records
or tile pins. A completed unchanged area does not redownload; Save can resume an
incomplete one. The map uses one GeoJSON source, data-driven color expressions,
and one shared neutral stripe image across all areas.

Verification:

- `npm run lint` and `npm run build`: passed (build includes TypeScript
  checking).
- Focused panel/service/geometry/map-source suite: 46 passed.
- `npm run test:ci`: 1,991 tests across 122 files passed. Coverage: statements
  90.68%, branches 82.78%, functions 92.91%, lines 92.85%.
- Final Dashboard/geometry regression run: 123 passed.
- Focused browser suite: 12 passed in Chromium/WebKit without retries. Exercises
  multiple creation, color stability after reload/edit/delete, action ordering,
  offline persistence/reconnect, and all corner/action targets on 320×300,
  320×568, and landscape screens. Inspected manager and short-editor
  screenshots.
- `npm run test:browser`: complete suite, 32 passed without retries.
- Both staged and unstaged `git diff --check`: passed. Existing staging and
  unrelated screenshot retained; no commit created.

Native bridge/OS behavior is unchanged. Storage regressions run against the
production repository and engine with fake IndexedDB plus real browser
IndexedDB; map rendering and touch targets run in WebKit/Chromium. Native
unit/build suites are not repeated for this web implementation. Physical
iOS/Android checks remain a release gate and have not been claimed as browser
evidence.

No new lesson file: this feedback is a feature-specific interaction preference.
The existing shared-layout lesson still applies to the action placement.
