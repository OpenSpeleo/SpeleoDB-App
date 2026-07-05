# Dashboard Map Shell

## Intent

The Dashboard map shell owns platform-facing map presentation without owning
project, landmark, or GPS domain state. `DashboardMapCanvas` composes MapLibre,
map chrome, and the location error surface; `useDashboardMapShell` owns the
small asynchronous state machine behind that presentation.

This boundary keeps `Dashboard.tsx` as a domain-orchestration façade while
preventing map-style, native location, icon, and viewport concerns from
expanding the page component.

## Ownership

The shell owns:

- cached map-style loading for the selected layer;
- validation, persistence, and publication of map-layer selection;
- north-up orientation locking when MapLibre reports ready;
- one-pass overlay icon registration and availability publication;
- finite zoom/latitude metrics for the distance scale;
- foreground live-location permission/watch ownership, one-time first-fix map
  flight and haptic feedback, toggle state, and error dismissal;
- route/app runtime gating for the foreground location and heading lifecycles;
- MapLibre viewport composition and the My Location/layer-control chrome; and
- map loading, distance-scale, depth-gauge, and geolocation-error surfaces.

`Dashboard.tsx` supplies already-derived project, overlay, GPS, depth, and
gesture inputs. The focused layer components still own their source/paint
declarations, and `useDashboardMapInteractions` still owns pointer timers and
marker selection. The shell does not read controller state, caches, or domain
preferences.

Native and storage calls are represented by `DashboardMapShellDependencies`. The
production defaults connect Capacitor, `TileCacheService`, `PreferencesService`,
and the map utility boundary; tests inject the same narrow contract directly.

## Invariants

- A superseded style success cannot replace the currently selected style.
- Unknown layer identifiers fall back to the canonical default before either
  persistence or shared-shell publication.
- Invalid or unchanged move events do not publish new viewport metrics.
- Orientation locking occurs before asynchronous icon registration starts.
- Icon availability becomes ready only after the complete registration pass.
- Permission denial never starts a watch and is represented by the shared
  permission-denied error sentinel.
- The My Location button stays loading through permission and watch startup
  until the first valid fix, then flies/haptics exactly once. Subsequent fixes
  update only the shared indicator.
- Explicit deactivation clears the manual fix. Route/app suspension instead
  retains toggle state and the last fix, releases native listeners, and resumes
  without another camera movement.
- Generation guards make delayed permission, watch-start, fix, and error
  completions inert after cancellation or suspension.
- Location and style failures reach the existing redacted diagnostic and modal
  boundaries; raw coordinates are never logged.

## Performance

Map style loading remains keyed only by layer selection. Icon registration
remains a single sequential pass on map load. Distance-scale state updates only
for finite, changed zoom/latitude pairs. Live location uses Android's one-second
update hints and is stopped when the map is hidden/backgrounded. Heading updates
are isolated to `UserLocationIndicator`; see `docs/user-location-heading.md`.

The focused canvas, location hook, heading service, and indicator keep sensor
state machines outside the Dashboard domain façade and avoid duplicating native
lifecycle policy at render call sites.

## Verification

`useDashboardMapShell.test.ts` directly covers style success/failure and stale
completion, icon readiness and missing refs, valid/fallback layer selection,
viewport filtering, denied/granted/failed live-location paths, first-fix camera
policy, suspension, missing map refs, native defaults, and rejected haptics.
Together with the Dashboard characterization suite it executes every statement,
branch, function, and line in both new production modules. `Dashboard.test.tsx`
remains the integration seam for actual layer composition, pointer forwarding,
chrome, depth/scale, offline selection, location modal behavior,
recording/manual indicator policy, native listener suspension, and orientation
locking.
