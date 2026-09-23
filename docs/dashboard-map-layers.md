# Dashboard Map Layers

## Intent

MapLibre source and layer declarations are presentation policy, not page
orchestration. They live in focused components under `src/pages/dashboard/` so
changes to project styling, overlays, GPS tracks, or the location dot do not
expand the Dashboard state machine.

## Ownership

- `ProjectMapLayers.tsx` owns the ordering anchor and per-project fill, line,
  and point layers, including depth and shot-color expressions (see
  [Shot colors](shot-colors.md)).
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
- Cave entrance visibility changes only the project point/star layer's
  `layout.visibility`. Linework, fill, GeoJSON, depth domains, and the camera
  remain unchanged.
- Global marker categories and station subtypes use layer visibility and the
  shared station-label filter. Sources stay mounted with the same data objects;
  toggles do not fetch data or reconstruct GeoJSON. Parent station visibility
  composes with each subtype without resetting subtype choices. Missing/null
  station types use Sensor. Icon loads and source refreshes receive the latest
  preferences on every render.
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

## GeoJSON line rendering across zoom levels

Every line-bearing GeoJSON source uses `GEOJSON_LINE_SOURCE_OPTIONS` from
`utils/geojsonLineRendering.ts`. Its `tolerance: 0` prevents the default
simplifier from discarding short features. The same module owns round caps/joins
and `createGeoJSONLineWidth`, the continuous width policy used by every line
layer, including polygon outlines. No line layer has a low-zoom visibility
cutoff.

Overview strokes are 1 px through zoom 8, 1.5 px at zoom 12, and 2 px at zoom
14, clamped to a layer's close-up width so thin outlines never grow thicker when
zooming out. The web viewers follow the same overview policy. From zoom 16, each
layer retains its established close-up emphasis:

| Line layer                         | Width at zoom 16 | Width at zoom 18 and above |
| ---------------------------------- | ---------------- | -------------------------- |
| Project survey and polygon outline | 2.5 px           | 2.5 px                     |
| GIS line                           | 2.5 px           | 2.5 px                     |
| GIS polygon outline                | 1.5 px           | 1.5 px                     |
| Saved GPS track                    | 6 px             | 7 px                       |
| Live/paused GPS recording          | 4 px             | 4 px                       |
| Offline download-area boundary     | 1.5 px           | 1.5 px                     |

Colors, fills, opacity, GPS dashes, visibility gates and source data retain
their existing semantics. This includes project/depth/shot modes and
cached/offline geometry. The policy changes presentation only, without replacing
lines with markers or changing exported geometry.

Keeping vertices costs additional tile processing and memory, particularly for
large GIS imports and GPS tracks. Expressions are built once when modules load;
zooming adds no listeners, network requests, geometry scans or layers. Keep
point-only marker sources and invisible ordering anchors outside this policy.

Tile-coordinate quantization and screen resolution still limit extreme zoom-out:
a subpixel cave cannot retain a recognizable shape. Increasing source maxzoom
does not increase low-zoom tile precision. Do not compensate with thick strokes
that obscure the neighboring passages.

## Verification and performance

`DashboardMapLayers.test.tsx` models `react-map-gl` source injection with
`Children.map`/`cloneElement` and proves that every project geometry layer,
subsurface icon, and GPS line receives its owning source ID. It also compiles
the production landmark color expression with MapLibre's style engine and proves
an empty pending-personal collection color resolves to a valid fallback. Both
project line/fill shot expressions are evaluated for valid opaque/alpha colors
and missing/malformed values. Category tests retain source/data identity while
checking every symbol, label and fallback; subtype tests evaluate the production
label expression, including legacy null/missing Sensor types. Depth expressions
are evaluated below, at and above a configured maximum. Overview tests evaluate
the production width expression, source tolerance, and source ownership in all
three color modes, plus every GIS, GPS and download-area line declaration.
`tests/browser/map-display.spec.ts` renders nine surveys built from roughly 10 m
shots across 70 km, plus separate GIS and GPS fixtures, and checks their canvas
pixels through three further zoom-outs in Chromium and WebKit. These browser
checks exercise the real renderer; physical-device performance with large
real-world survey collections remains a separate validation step.
`UserLocationIndicator.test.tsx` proves the same direct source-injection
contract for the dot plus its fixed SVG geometry and dot-only fallback. The
Dashboard characterization suite verifies surrounding source selection,
lifecycle, and map readiness. Heading updates rerender only the indicator; the
cone is a fixed-size DOM marker and creates no zoom-dependent GeoJSON work.
