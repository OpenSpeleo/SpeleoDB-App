# Dashboard Project Visibility

## Intent

`useDashboardProjectVisibility` owns project-layer visibility intent and the
country-level gate used by every dashboard map consumer. The hook keeps storage,
state transitions, and map-zoom side effects out of `Dashboard.tsx` while
preserving `ProjectPanel` as a presentational component.

## Ownership boundary

The hook owns:

- restoration and persistence of per-project visibility;
- restoration and persistence of country visibility and collapse state;
- removal of projects that are no longer eligible for GeoJSON rendering;
- default-on behavior for newly eligible projects unless explicitly disabled;
- panel rows and raw panel-toggle state derived from currently loaded map data;
- the effective visibility set used by map layers, overlays, depth probing, and
  initial fit;
- show-all, hide-all, project, country, and collapse actions; and
- zoom activation, country-gate recovery, panel close, and bounded map fit.

`useDashboardMapData` supplies commit-matched GeoJSON and prevalidated bounds;
`Dashboard.tsx` connects those values to this hook. `ProjectPanel.tsx` only
renders values and invokes callbacks. `PreferencesService` remains the single
serialization boundary for non-secret visibility settings.

## Visibility invariants

A project is effectively visible only when all of these are true:

1. the project is present in the current project list;
2. its individual visibility intent is on;
3. current commit-matched GeoJSON is loaded; and
4. its country gate is not explicitly off.

The panel toggle reflects raw individual intent, not the country gate. This lets
a user disable a country temporarily without losing project-level choices. Show
all activates every loaded project and re-enables their country gates. Hide all
disables loaded projects but preserves the country gates.

Projects that become ineligible are removed from runtime state. A project that
is newly eligible defaults on unless its stored preference is `false`; rerenders
must not re-enable a project the user just turned off.

## Zoom contract

Selecting a project always persists its individual visibility as on. If its
country gate is off, the hook persists that gate as on, closes the project
panel, then schedules a `fitBounds` against the commit-matched prevalidated
bounds. Missing projects, missing bounds, and a map that unmounted before the
scheduled callback are safe no-ops.

## Performance

Visibility derivations are memoized over the project list, loaded GeoJSON,
individual intent, and country gates. Zoom uses stored bounds and never scans
GeoJSON coordinates. Preference and map collaborators are injectable for
deterministic tests, while production defaults preserve the existing native
haptic and zero-delay scheduling behavior.

## Verification

`useDashboardProjectVisibility.test.ts` directly covers preference restoration,
eligibility changes, all toggle and bulk transitions, country fallback,
collaborator defaults, haptic failure, scheduled zoom, missing bounds, and map
unmount. The module has 100% statement, branch, function, and line coverage.
`Dashboard.test.tsx` remains the integration characterization seam for project
data loading, quarantine, panel wiring, overlay visibility, and bounds fitting.
