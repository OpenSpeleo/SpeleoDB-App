# Dashboard Map Layers

## Intent

MapLibre source and layer declarations are presentation policy, not page
orchestration. They live in focused components under `src/pages/dashboard/` so
changes to project styling, overlays, GPS tracks, or the location dot do not
expand the Dashboard state machine.

## Ownership

- `ProjectMapLayers.tsx` owns the ordering anchor and per-project fill, line,
  and point layers, including depth-color expressions.
- `OverlayMapLayers.tsx` owns landmark, surface/subsurface station, exploration
  lead, and cylinder layers, labels, icon availability, and visual fallbacks.
- `GpsMapLayers.tsx` owns saved-track and active-recording line sources/layers.
- `UserLocationIndicator.tsx` owns the shared manual/recording location dot and
  phone-heading cone. See `docs/user-location-heading.md`.
- `useDashboardMapData` supplies normalized, commit-gated project and overlay
  data; see `docs/dashboard-map-data.md`.
- `DashboardMapCanvas.tsx` composes these focused layers with cached map style,
  icon readiness, viewport chrome, and user location; see
  `docs/dashboard-map-shell.md`.
- `Dashboard.tsx` connects already-derived data and visibility state. It owns no
  layer paint/layout declaration. Pointer interaction orchestration is owned by
  `useDashboardMapInteractions`; see `docs/dashboard-map-interactions.md`.

The GeoJSON layer components are deliberately data-in/render-out. They do not
fetch, mutate storage, schedule work, register listeners, or retain local state.
`UserLocationIndicator` is the narrow exception: it subscribes to the shared
heading provider only while its explicit `headingActive` input is true.

## Invariants

- Every MapLibre `Layer` is a direct child of its owning `Source`. The
  `react-map-gl` `Source` component clones immediate children to inject the
  source ID; an intervening component that does not forward `source` silently
  creates an unbound layer declaration.
- Project geometry remains below marker layers through the stable ordering
  anchor, including after visibility changes.
- Project layers mount only when both effective visibility and current GeoJSON
  are present.
- Overlay icon layers mount only after icon loading completes. Exploration and
  cylinder fallbacks remain mutually exclusive with their icon layers.
- Landmark marker and label colors use MapLibre `to-color` with the app
  fallback. This is required for queued personal-landmark creates, whose
  collection color is empty until the server assigns the personal collection
  during replay.
- Saved and active GPS tracks are separate sources; the active line is absent
  when recording is idle or has no points.
- `user-location-dot` remains a direct child of `user-location-source`; its ID
  remains stable for long-press collision protection.
- The user-location indicator is absent when neither manual live mode nor an
  active/paused recording supplies a valid point. A paused recording alone is
  dot-only; a live manual mode or active recording may own the cone.

## Verification and performance

`DashboardMapLayers.test.tsx` models `react-map-gl` source injection with
`Children.map`/`cloneElement` and proves that every project geometry layer,
subsurface icon, and GPS line receives its owning source ID. It also compiles
the production landmark color expression with MapLibre's style engine and proves
an empty pending-personal collection color resolves to a valid fallback.
`UserLocationIndicator.test.tsx` proves the same direct source-injection
contract for the dot plus its fixed SVG geometry and dot-only fallback. The
Dashboard characterization suite verifies surrounding source selection,
lifecycle, and map readiness. Heading updates rerender only the indicator; the
cone is a fixed-size DOM marker and creates no zoom-dependent GeoJSON work.
