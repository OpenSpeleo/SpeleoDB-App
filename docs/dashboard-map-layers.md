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
- `GpsMapLayers.tsx` owns saved-track, active-recording, and user-location
  sources and layers.
- `useDashboardMapData` supplies normalized, commit-gated project and overlay
  data; see `docs/dashboard-map-data.md`.
- `DashboardMapCanvas.tsx` composes these focused layers with cached map style,
  icon readiness, viewport chrome, and user location; see
  `docs/dashboard-map-shell.md`.
- `Dashboard.tsx` connects already-derived data and visibility state. It owns no
  layer paint/layout declaration. Pointer interaction orchestration is owned by
  `useDashboardMapInteractions`; see `docs/dashboard-map-interactions.md`.

The components are deliberately data-in/render-out. They do not fetch, mutate
storage, schedule work, register listeners, or retain local state.

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
- Saved and active GPS tracks are separate sources; the active line is absent
  when recording is idle or has no points.
- The user-location dot is absent until the page has obtained a location.

## Verification and performance

`DashboardMapLayers.test.tsx` models `react-map-gl` source injection with
`Children.map`/`cloneElement` and proves that every project geometry layer,
subsurface icon, and GPS line receives its owning source ID. It also covers
visibility/data omission and icon availability. The Dashboard characterization
suite verifies the surrounding data and map-readiness orchestration.
The split changes React component ownership only: it adds no MapLibre source,
network request, timer, listener, or data scan. All production modules remain
below the 600-line budget and all layer functions remain at or below 80 lines.
