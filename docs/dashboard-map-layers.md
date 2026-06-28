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
- `Dashboard.tsx` supplies already-derived data and visibility state. It owns
  no layer paint/layout declaration.

The components are deliberately data-in/render-out. They do not fetch, mutate
storage, schedule work, register listeners, or retain local state.

## Invariants

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

`DashboardMapLayers.test.tsx` plus the Dashboard characterization suite execute
every statement, branch, and function in the three production layer modules.
The split changes React component ownership only: it adds no MapLibre source,
network request, timer, listener, or data scan. All production modules remain
below the 600-line budget and all layer functions remain at or below 80 lines.
