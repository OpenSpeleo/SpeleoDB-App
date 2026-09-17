# Dashboard Panel State

## Intent

The Projects, Geometries, Landmarks, GPS, and Offline Maps panels occupy the
same dashboard slot and are mutually exclusive. Their state is therefore one
navigation value, not independent booleans:

```ts
type DashboardPanel =
  "projects" | "gis-geometries" | "landmarks" | "gps" | "offline-maps" | null;
```

This representation makes simultaneous panels impossible and replaces six
cross-route props with one value and one transition callback.

## Ownership and flow

`AuthenticatedAppShell` owns `activeDashboardPanel` because it outlives every
authenticated route transition. Dashboard remains mounted to preserve map state;
Settings and Pending mount only while active. The value and
`onDashboardPanelChange` are passed to Dashboard and whichever non-map page is
active, plus their shared `AppTabBar`.

`AppTabBar` owns tab transition policy:

- selecting a panel tab from another route navigates to Dashboard and activates
  that panel;
- selecting the already-active panel tab on Dashboard closes it;
- selecting another panel replaces the current value atomically;
- selecting Map navigates to Dashboard and clears the active panel; and
- Settings and Pending navigation preserve the value while Dashboard is hidden.

Dashboard derives each presentational `isOpen` prop by comparing the single
value. Panel-owned close, backdrop, zoom, and action callbacks publish `null`.
Settings clears the value before restarting the guided tour so a hidden panel
cannot cover the first tour step.

## Invariants

- At most one dashboard panel is active at any render boundary.
- Opening a different panel requires one state publication, not a sequence of
  close/open updates.
- No consumer can construct a project-plus-landmark, project-plus-GPS, or
  landmark-plus-GPS state.
- The shell preserves one value while Settings or Pending unmount; returning to
  Dashboard cannot resurrect a stale second boolean.
- The union is ephemeral UI state. It is neither persisted nor owned by a domain
  controller.

## Performance and verification

One state update replaces up to three coupled React updates when switching
panels. Prop threading drops from six values to two on every authenticated page.
Only Dashboard remains mounted across route changes; Settings and Pending
release their timers, effects, and local modal state when inactive.

`AuthenticatedAppShell.test.tsx` proves the authoritative cross-route sequence
`null -> projects -> landmarks -> gps -> null`, Dashboard state preservation,
and inactive-page unmount cleanup. `AppTabBar.test.tsx` covers route navigation,
activation, replacement, same-tab close, Map close, and recording/pending
presentation. Dashboard, Settings, Pending, and shared-state tests exercise the
page integration contract.

Projects, Geometries and GPS share `DashboardSidePanel` for panel positioning,
safe areas, backdrop, Escape, focus return and inert closed content. Geometries
uses the Projects list presentation; its visibility and name-tap framing are
documented in [GIS Geometry](gis-geometry.md).

Offline Maps opens from the map download button or Settings. Selection hides the
tab bar and other map controls; dirty route departure is guarded by the editor.
All manual area rectangles are shown while this panel is active on Dashboard,
including its editor, and hidden when it closes, another panel opens, or
Dashboard becomes inactive. Legacy per-area visibility flags do not control
presentation. The persisted area catalog is separate from this ephemeral panel
state; opening or closing the menu never changes download intent or recalculates
tiles.
