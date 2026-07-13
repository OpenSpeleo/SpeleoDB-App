# Map Tile Layers

This document defines the changeable map tile-layer feature: layer definitions,
the layer switcher, per-layer offline sync, prioritized prefetch, magic-hash
missing-tile detection, offline gating, and storage-cap interaction.

## Feature intent

Reproduce the website private map viewer's layer switcher
(`SpeleoDB/frontend_private/static/private/js/map_viewer/config.js` +
`map/sources.js`) in the mobile app, adapted to the app's maplibre +
`cached-https` offline architecture. The app ships **ESRI raster layers only**
(the website's Mapbox source is intentionally dropped because the app has no
Mapbox token).

## Layers (single source of truth)

Layers are defined once in `MAP_LAYERS` (`src/constants.ts`), typed by
`MapLayerDefinition` (`src/types/mapLayer.ts`):

| id                          | label                       | max zoom | offline sync              |
| --------------------------- | --------------------------- | -------- | ------------------------- |
| `esri-satellite`            | ESRI - Satellite            | 18       | forced ON (default layer) |
| `esri-world-hillshade`      | ESRI - World Hillshade      | 18       | opt-in                    |
| `esri-world-hillshade-dark` | ESRI - World Hillshade Dark | 18       | opt-in                    |

All layers use `maxZoom: 18` for **offline parity**. The ESRI World Hillshade
cache exposes 24 LODs (0-23) and returns valid tiles above z16 (full-resolution
only in select regions), so capping it lower than satellite left it heavily
overzoomed and sparse around projects/landmarks when zoomed in. Matching
satellite's z18 makes the prefetch depth, tile count, and display sharpness
equal across layers.

> **Caveat (intentional divergence from the website).** The website map viewer
> caps both hillshade layers at `maxzoom: 16`. The app raises them to 18, which
> has two consequences to keep in mind:
>
> 1. **Storage**: prefetch depth grows ~4x per extra zoom level, so an enabled
>    hillshade layer pins roughly an order of magnitude more tiles than at z16.
>    With satellite plus both hillshade layers enabled, three large layers
>    compete for the single 500 MB cap and the over-limit consent prompt fires
>    much sooner (see "Storage cap + override").
> 2. **Coverage**: at z17/z18 the app requests hillshade tiles ESRI only renders
>    full-resolution in some regions. Elsewhere ESRI may return a 404 (rendered
>    blank, harmless) or a gray "no-data" placeholder. The magic-hash list only
>    contains the **satellite** no-data fingerprint, so a gray _hillshade_
>    placeholder is cached/drawn as if it were real terrain. This must be
>    verified on device before shipping (see the device test plan).

Each definition carries `tileUrlTemplate` (`{z}/{x}/{y}` XYZ),
`noDataSha256Hashes`, `tileSize`, `maxZoom`, `attribution`, `forcedOffline`, and
`isDefault`. Exactly one layer is `forcedOffline` (satellite).
`DEFAULT_MAP_LAYER_ID` is the satellite id.

Accessors and style assembly live in `src/services/MapLayersService.ts`
(`getAllMapLayers`, `getMapLayerById`, `resolveMapLayer`, `buildLayerStyle`,
`isLayerTileUrl`).

## Style building

The app builds the maplibre style at runtime from `MAP_LAYERS` rather than
fetching a remote style document:

- `MapLayersService.buildLayerStyle(layerId)` returns a single-source raster
  style (raw `https://` URLs). The display raster layer uses `maxzoom` =
  `ceil(MAP.MAX_ZOOM)` so display zooms past the source `maxzoom` (18) overzoom
  the deepest cached tiles, matching satellite's mild overzoom.
- `TileCacheService.getCachedLayerStyle(layerId)` wraps it and rewrites tile
  URLs to the `cached-https://` protocol so every tile request flows through the
  offline cache + missing-tile check. Because the config is bundled, the style
  resolves offline with no cached style document required.
- `useDashboardMapShell` loads style state from `selectedMapLayerId`; switching
  layers rebuilds `mapStyle` and react-map-gl re-applies it.
  `public/map-style-satellite.json` remains only as a static satellite fallback
  / service-worker precache entry.

## Layer switcher (Dashboard)

`src/components/map/MapLayerControl.tsx` renders a FAB (stacked-layers icon
copied from the website) directly under the My Location FAB, sharing the exact
FAB styling. Tapping opens a radio menu of layers. Selecting a layer persists
`selectedMapLayerId` (`PreferencesService`) and updates shared shell state
(`AuthenticatedAppShell`), which rebuilds the style.

`isLayerSelectable(layer, isOfflineLocked, layerOfflineSync)` (in
`MapLayersService`) gates selection: when offline-locked, only the forced
satellite layer and opted-in (synced) layers are selectable; others are disabled
with a "Not downloaded" hint, because their tiles are not cached and would
render blank.

> Gating is based on the **opt-in toggle**, not on actual cache coverage. A
> layer that was toggled on but only partially synced (or whose tiles were
> evicted) can still be selected offline and render blank for the un-cached
> area. This is an accepted limitation; the toggle is the cheap proxy for
> "intended to be available offline".

## Per-layer offline sync (Settings "Map Layers")

The Settings "Map Layers" section lists every layer with an offline-sync toggle
and a per-layer sync percentage:

- The satellite toggle is forced ON and disabled.
- Extra-layer toggles are also disabled while the app is offline-locked:
  enabling schedules a network prefetch and disabling reconciles cached tiles,
  neither of which can run offline. The row subtitle reads "unavailable
  offline".
- Toggling enters through `SpeleoDBController.setLayerOfflineSync` and is owned
  by `TileCoordinator.setLayerOfflineSync(layerId, enabled)`:
  - persists the opt-in (`layerOfflineSync` in `PreferencesService`),
  - when enabling while online, reuses the persisted canonical coordinate plan
    and schedules only the new layer URL namespace,
  - falls back to complete fail-closed planning only when no valid active plan
    exists,
  - when disabling, cancels the multi-layer run, releases the layer's
    active/pending generations, evicts its URL prefix, refreshes statistics, and
    resumes remaining layers from the active plan. Release failure prevents
    eviction and rolls the toggle back.
- Per-layer percentage comes directly from `OfflineMapSyncSnapshot.layers`.
  Runtime browsing tiles are excluded because they have no generation
  membership.

State is shared from `AuthenticatedAppShell` (`selectedMapLayerId`,
`layerOfflineSync`) to both Dashboard and Settings so the two tabs stay
consistent while mounted.

## Canonical plan, priority, and progress

- Projects, landmarks, stations, and GPS paths are unioned into one immutable,
  layer-independent `{z,x,y}` plan. Tiles remain keyed by full provider URL.
- The worker packs and deduplicates coordinates in memory with a hard ceiling of
  1,000,000 unique tiles. It sorts the final keys and transfers at most 2,048
  final coordinates at a time, waiting for each compact plan-chunk write before
  continuing. The stable `N*M` total is published only after final chunks are
  durable.
- **Priority**: coordinates expand satellite first, then enabled extra layers. A
  six-worker queue downloads ready URLs while 16-coordinate auditing continues.
  Outstanding coordinates are backpressured at 64.
- Extra layers reuse the exact same coordinates; only the URL template differs.
  All current layers use zoom 0-18, making `N*M` an enforced invariant.
- The planner accepts validated `ProjectGeoJSONBounds`, never raw project
  GeoJSON. It preserves the directed longitude arc across the antimeridian,
  deduplicates overlapping/root ranges, applies meter padding, preserves
  zero-width bounds, and clamps latitude to finite Web Mercator before deriving
  tile rows. Validation rejects projection-amplified polar bounds before this
  consumer can create a world-scale tile set.
- Geometry changes produce a new plan revision. The prior layer generations
  remain usable until the replacement succeeds; failed/cancelled work releases
  only pending ownership.
- The revision is an asynchronous length-delimited SHA-256. Unavailable hashing
  or any incomplete required project/overlay/current-SHA GPS input aborts the
  replacement and preserves all active generations.
- Live per-tile progress is published through a dedicated external store at the
  next animation frame. It never waits for one-second durable checkpoints or
  triggers controller-wide application updates.

## Magic-hash missing-tile detection

`MapLayerDefinition.noDataSha256Hashes` owns provider-specific SHA-256
fingerprints. The website's known fingerprint is configured only on
`esri-satellite`; both hillshade lists are intentionally empty pending
independent provider evidence. In `TileCacheService`:

- After a raster tile downloads, `isMissingDataTile(url, data)` resolves its
  layer, hashes the bytes only when that layer has configured fingerprints, and
  checks membership.
- Runtime: a match stores only a zero-byte metadata tombstone and throws
  `MissingTileError`, so MapLibre renders nothing. The provider payload is never
  retained. A fresh tombstone resolves offline without a network call.
- Prefetch: the tombstone and pending layer-generation membership commit in one
  transaction. The coordinate counts as completed synchronization work because
  the HTTP response was valid and its no-data identity was verified.
- HTTP errors remain failures. In particular, a 404 does not create a tombstone
  and does not count as completed.
- Tombstones use the same 180-day fetch freshness as raster payloads. A stale
  tombstone still renders as missing immediately while it refreshes, and a
  forced refresh bypasses its freshness.
- Cheap guards skip hashing when the layer list is empty or the URL is not a
  configured raster tile. Cache hits are never re-hashed. If a configured hash
  cannot be computed because `crypto.subtle` is absent/fails, validation fails
  closed and nothing is cached.
- One 10-second deadline covers headers, accepted image content type, non-empty
  body, hashing, and cancellation. HTTP/validation failures never enter the
  tombstone path.

## Storage cap + override

Extra-layer prefetch writes are pinned and share the single 500 MB cap
(`MAP.TILE_CACHE_MAX_BYTES`) and the one-time storage-consent / override flow
documented in `docs/offline-mode.md`. There is no separate per-layer cap; all
layers compete for the same pinned budget and honor the user's override.

## Migration

- IndexedDB `speleo_tiles` is v8. Payloads, v7 manifests, generations, and
  memberships are preserved. The former v8 coordinate-staging store remains
  schema-compatible and is cleared during recovery, but current planners write
  only final compact chunks. The incremental, payload-preserving v6 migration is
  described in `docs/tile-cache-architecture.md`.

## Source code

- Layer config: `src/constants.ts` (`MAP_LAYERS`,
  `MAP.MISSING_TILE_SHA256_HASHES`), `src/types/mapLayer.ts`
- Layer accessors + style: `src/services/MapLayersService.ts`
- Style cache wrapper + magic hash: `src/services/TileCacheService.ts`
- Switcher UI/state: `src/components/map/MapLayerControl.tsx`,
  `src/pages/dashboard/DashboardMapCanvas.tsx`,
  `src/pages/dashboard/useDashboardMapShell.ts`
- Settings section: `src/pages/Settings.tsx`
- Shared state: `src/AuthenticatedAppShell.tsx`
- Preferences: `src/services/PreferencesService.ts`
- Offline-map plan/engine/store: `src/services/OfflineMapPlanner.ts`,
  `src/services/OfflineMapSyncEngine.ts`, `src/services/OfflineMapSyncStore.ts`
- Scheduling + per-layer toggle: `src/controllers/TileCoordinator.ts`

## Tests

- `src/services/MapLayersService.test.ts`: layer config invariants,
  `buildLayerStyle`, `isLayerTileUrl`.
- `src/services/TileCacheService.test.ts`: magic-hash tombstones, HTTP-error
  separation, hash-miss passthrough, empty-list bypass, and
  `getCachedLayerStyle` rewrite.
- `src/services/tileCache/TileCacheRepository.test.ts`: payload-preserving
  migration, legacy v8 staging recovery/GC, layer generations, transaction
  aborts, atomic concurrent eviction, and statistics.
- `src/services/OfflineMapSyncEngine.test.ts`: six-worker scheduling, manifest
  fast path, per-tile progress, and retry head-of-line avoidance.
- `src/services/OfflineMapSyncEngine.repository.test.ts`: real fake-IndexedDB
  draining through payload and membership transactions.
- `src/services/OfflineMapPlanner.test.ts`: canonical source union, packed
  deduplication, the 1M limit, and final chunks.
- `src/services/tilePrefetchPlanner.test.ts`: meter padding, zoom ranges,
  dateline/root deduplication, zero-width bounds, and latitude clamping.
- `src/services/PreferencesService.test.ts`: `selectedMapLayerId` +
  `layerOfflineSync` normalization, forced-layer semantics.
- `src/controllers/SpeleoDBController.test.ts`: satellite-first ordering,
  `setLayerOfflineSync` enqueue/cleanup, offline skip.
- `src/pages/Settings.test.tsx`: Layers toggles (satellite forced) + per-layer
  %.
- `src/components/map/MapLayerControl.test.tsx`,
  `src/pages/dashboard/useDashboardMapShell.test.ts`, and
  `src/pages/Dashboard.test.tsx`: switcher, persistence, offline disable, style,
  location, and map-shell integration.

## Residual risks & manual device test plan (iOS + Android)

Some behavior cannot be covered by jsdom unit tests and must be verified on real
devices before shipping:

- **Hillshade z18 (see Layers caveat)**: enable both hillshade layers, zoom to
  z17/z18 over low-coverage regions, and confirm there are NO gray "no-data"
  squares being cached/drawn and NO 404 storms. Watch the 500 MB over-limit
  consent prompt with satellite + both hillshade layers enabled.
- **Style switch**: rapidly switch layers and confirm overlays (projects,
  landmarks, user-location dot) reattach with no flicker/leak, and that the
  `cached-https` protocol + magic-hash check still apply after the switch
  (react-map-gl re-adds the declarative sources on `setStyle`).
- **`crypto.subtle`** must exist in the iOS/Android WebView for satellite
  validation; absence is an explicit terminal validation failure, never a silent
  cache bypass.
- **Settings row centering** uses shadow-DOM `::part(native)`; verify rows are
  vertically centered (not top-heavy) on both platforms for single- and
  multi-line rows.
- **Removal under load**: disable an optional layer during a multi-layer run;
  verify release completes before prefix eviction, remaining layers resume from
  the active plan, and an injected release failure preserves payloads/toggle.

## Change checklist

1. Keep `MAP_LAYERS` the single source of truth for layer ids, labels, URLs,
   zoom.
2. Preserve satellite-first prefetch ordering and satellite-only project
   progress.
3. Keep the magic-hash check guarded (raster tiles only) and off the cache-hit
   path.
4. Route all tile requests through `cached-https` (offline + missing-tile
   check).
5. Run targeted vitest for touched paths + `npm run build`.
6. Update this document if layer behavior changes.
