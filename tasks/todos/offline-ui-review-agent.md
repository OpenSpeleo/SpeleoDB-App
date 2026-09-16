# Offline map UI adversarial review

- [x] Read the working diff, relevant coding rules and map-layout/lifecycle
      lessons.
- [x] Review menu visibility, camera fitting, row hit targets, scrolling and
      observer lifetime against their production seams.
- [x] Reproduce actionable regressions before selecting the smallest corrective
      change.
- [x] Apply confirmed corrections with focused regression coverage, or record
      that no correction is justified.
- [x] Report focused verification and remaining device limitations to the
      primary reviewer.

## Plan review

Source files and source tests belong to this review agent. The primary reviewer
owns browser tests, documentation, repository-wide validation and the final
commit. Preserve current behavior unless an actual regression is demonstrated;
do not replace native scrolling or broaden the camera abstraction speculatively.

## Review results

P2: `OfflineMapsPanel.tsx` places its error paragraph outside the scroll region,
and `offlineMaps.css` prevents every such sibling from shrinking. At the 242 px
sheet floor, an actual service error leaves roughly 30 px for the entire list,
less than a 44 px edit/delete button; longer persistence errors can consume the
list entirely. The previous whole-sheet scrolling kept these actions reachable.

Corrective plan, reviewed for scope: move only the error paragraph into the row
scroll region, preserving static title/Add controls. Add a component ownership
assertion; ask the primary reviewer to verify short-viewport rendering in the
real-browser regression. No change to storage, errors, camera or native APIs.

Full validation and commit evidence will be recorded by the primary reviewer.

## Focused verification

- Review baseline: 177 tests passed across the list, panel, Dashboard, map
  layers, GPS/project actions and area-geometry test files.
- The new panel regression failed before the fix because the alert was outside
  the row region; it passes after moving the alert inside.
- `npm run test.unit -- --run src/components/map/OfflineAreaList.test.tsx src/components/map/OfflineMapsPanel.test.tsx src/pages/Dashboard.test.tsx src/pages/dashboard/DownloadAreaMapLayers.test.tsx src/pages/dashboard/useDashboardGpsTrackActions.test.tsx src/pages/dashboard/useDashboardProjectVisibility.test.ts src/services/downloadAreaGeometry.test.ts`:
  178 tests passed across seven files.
- `git diff --check`: passed.
- No storage, native API or background lifecycle changes were needed. No
  physical-device verification was performed by this review agent.
