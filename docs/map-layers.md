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

| id | label | max zoom | offline sync |
|---|---|---|---|
| `esri-satellite` | ESRI - Satellite | 18 | forced ON (default layer) |
| `esri-world-hillshade` | ESRI - World Hillshade | 18 | opt-in |
| `esri-world-hillshade-dark` | ESRI - World Hillshade Dark | 18 | opt-in |

All layers use `maxZoom: 18` for **offline parity**. The ESRI World Hillshade cache exposes 24 LODs (0-23) and returns valid tiles above z16 (full-resolution only in select regions), so capping it lower than satellite left it heavily overzoomed and sparse around projects/landmarks when zoomed in. Matching satellite's z18 makes the prefetch depth, tile count, and display sharpness equal across layers.

> **Caveat (intentional divergence from the website).** The website map viewer
> caps both hillshade layers at `maxzoom: 16`. The app raises them to 18, which
> has two consequences to keep in mind:
> 1. **Storage**: prefetch depth grows ~4x per extra zoom level, so an enabled
>    hillshade layer pins roughly an order of magnitude more tiles than at z16.
>    With satellite plus both hillshade layers enabled, three large layers
>    compete for the single 500 MB cap and the over-limit consent prompt fires
>    much sooner (see "Storage cap + override").
> 2. **Coverage**: at z17/z18 the app requests hillshade tiles ESRI only renders
>    full-resolution in some regions. Elsewhere ESRI may return a 404 (rendered
>    blank, harmless) or a gray "no-data" placeholder. The magic-hash list only
>    contains the **satellite** no-data fingerprint, so a gray *hillshade*
>    placeholder is cached/drawn as if it were real terrain. This must be
>    verified on device before shipping (see the device test plan).

Each definition carries `tileUrlTemplate` (`{z}/{x}/{y}` XYZ), `tileSize`,
`maxZoom`, `attribution`, `forcedOffline`, and `isDefault`. Exactly one layer is
`forcedOffline` (satellite). `DEFAULT_MAP_LAYER_ID` is the satellite id.

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
- The Dashboard's style effect depends on `selectedMapLayerId`; switching layers
  rebuilds `mapStyle` and react-map-gl re-applies it. `public/map-style-satellite.json`
  remains only as a static satellite fallback / service-worker precache entry.

## Layer switcher (Dashboard)

`src/components/map/MapLayerControl.tsx` renders a FAB (stacked-layers icon
copied from the website) directly under the My Location FAB, sharing the exact
FAB styling. Tapping opens a radio menu of layers. Selecting a layer persists
`selectedMapLayerId` (`PreferencesService`) and updates shared shell state
(`AuthenticatedAppShell`), which rebuilds the style.

`isLayerSelectable(layer, isOfflineLocked, layerOfflineSync)` (in `MapLayersService`) gates selection:
when offline-locked, only the forced satellite layer and opted-in (synced)
layers are selectable; others are disabled with a "Not downloaded" hint, because
their tiles are not cached and would render blank.

> Gating is based on the **opt-in toggle**, not on actual cache coverage. A
> layer that was toggled on but only partially synced (or whose tiles were
> evicted) can still be selected offline and render blank for the un-cached
> area. This is an accepted limitation; the toggle is the cheap proxy for
> "intended to be available offline".

## Per-layer offline sync (Settings "Map Layers")

The Settings "Map Layers" section lists every layer with an offline-sync toggle and
a per-layer sync percentage:

- The satellite toggle is forced ON and disabled.
- Extra-layer toggles are also disabled while the app is offline-locked: enabling
  schedules a network prefetch and disabling reconciles cached tiles, neither of
  which can run offline. The row subtitle reads "unavailable offline".
- Toggling enters through `SpeleoDBController.setLayerOfflineSync` and is owned
  by `TileCoordinator.setLayerOfflineSync(layerId, enabled)`:
  - persists the opt-in (`layerOfflineSync` in `PreferencesService`),
  - when enabling while online, immediately schedules that layer's prefetch
    using persisted validated project bounds plus landmark boxes,
  - when disabling, removes the layer's prefetch jobs
    (`TilePrefetchService.removeLayer`) and evicts its cached tiles by URL
    prefix (`TileCacheService.evictLayerTiles`) to reclaim space. `removeLayer`
    also prunes the in-memory cache-presence hints for that layer's tiles, so a
    later re-enable in the same session re-downloads them instead of treating
    them as still cached.
- Per-layer percentage is computed from prefetch jobs grouped by `layerId`.
  Runtime-cached ("manual") tiles are excluded from per-layer math since they
  cannot be reliably attributed to one layer.

State is shared from `AuthenticatedAppShell` (`selectedMapLayerId`,
`layerOfflineSync`) to both Dashboard and Settings so the two tabs stay
consistent while mounted.

## Prefetch: namespacing, priority, progress

- `TilePrefetchJobState` carries a `layerId`. The IndexedDB job key is
  `prefetchJobKey(layerId, targetId)` = `${layerId}::${targetId}` (target =
  project id or `landmarks`), so the same target has independent jobs per layer.
- **Tiles are keyed by full URL**, which already uniquely encodes layer + z/x/y
  (each layer has a distinct host/path). No tile re-keying is needed.
- **Priority**: `TileCoordinator.scheduleSyncPhase` enqueues satellite
  landmark + project jobs first, then each enabled extra layer. The prefetch
  queue is FIFO, so satellite tiles always download before extra-layer tiles.
- Extra layers reuse the same validated project bounds and landmark points read
  once per sync; only the tile URL template differs. `buildLayerPrefetchRequest`
  clamps the request max zoom to the layer's configured `maxZoom` (all layers are
  z18, so prefetch depth is identical across layers).
- The planner accepts validated `ProjectGeoJSONBounds`, never raw project
  GeoJSON. It preserves the directed longitude arc across the antimeridian,
  deduplicates overlapping/root ranges, applies meter padding, preserves
  zero-width bounds, and clamps latitude to finite Web Mercator before deriving
  tile rows. Validation rejects projection-amplified polar bounds before this
  consumer can create a world-scale tile set.
- The tile-prefetch **phase result** (and the project panel progress) reflect
  **satellite only**. Extra-layer scheduling is best-effort and does not affect
  the sync phase contract. The project panel filters jobs to
  `layerId === 'esri-satellite'`.
- A project GeoJSON quarantine removes that target's jobs across all layers and
  prunes queued/in-flight ownership without evicting shared cached tiles.
  Per-target generations and serialized job persistence make removal
  linearizable: stale cache checks, enqueue/status writes, and retry waits cannot
  recreate the removed target. Shared active downloads continue for remaining
  owners; solely-owned active work aborts. A job-deletion failure is logged and
  does not reopen the target in the current runtime.

## Magic-hash missing-tile detection

`MAP.MISSING_TILE_SHA256_HASHES` (`src/constants.ts`) lists SHA-256
fingerprints of provider "no data" placeholder tiles (copied from the website's
`DEFAULTS.MAP.MISSING_TILE_SHA256_HASHES`). In `TileCacheService`:

- After a raster tile downloads (runtime `fetchWithCache` and prefetch
  `fetchAndCacheTile`), `isMissingDataTile(url, data)` hashes the bytes and
  checks membership.
- Runtime: a match throws `MissingTileError`, which is not cached and does not
  fall back to cache, so maplibre renders nothing (treated as a 404).
- Prefetch: a match returns 0 bytes (counted as processed, never stored, no
  retry).
- Cheap guards: skipped when the hash list is empty, when the URL is not a
  configured raster tile (`isLayerTileUrl`), or when `crypto.subtle` is
  unavailable. Cache hits are never re-hashed.

## Storage cap + override

Extra-layer prefetch writes are pinned and share the single 500 MB cap
(`MAP.TILE_CACHE_MAX_BYTES`) and the one-time storage-consent / override flow
documented in `docs/offline-mode.md`. There is no separate per-layer cap; all
layers compete for the same pinned budget and honor the user's override.

## Migration

- IndexedDB `speleo_tiles` bumped `v3 -> v4`. The migration namespaces existing
  bare-keyed prefetch jobs to `esri-satellite::<targetId>` and sets their
  `layerId`. Tiles are untouched (URL-keyed), so previously downloaded satellite
  tiles remain valid with zero loss.

## Source code

- Layer config: `src/constants.ts` (`MAP_LAYERS`, `MAP.MISSING_TILE_SHA256_HASHES`), `src/types/mapLayer.ts`
- Layer accessors + style: `src/services/MapLayersService.ts`
- Style cache wrapper + magic hash: `src/services/TileCacheService.ts`
- Switcher UI: `src/components/map/MapLayerControl.tsx`, `src/pages/Dashboard.tsx`
- Settings section: `src/pages/Settings.tsx`
- Shared state: `src/AuthenticatedAppShell.tsx`
- Preferences: `src/services/PreferencesService.ts`
- Prefetch jobs: `src/types/tilePrefetch.ts`, `src/services/TilePrefetchService.ts`, `src/services/tileCache/TileCacheRepository.ts`
- Scheduling + per-layer toggle: `src/controllers/TileCoordinator.ts`

## Tests

- `src/services/MapLayersService.test.ts`: layer config invariants, `buildLayerStyle`, `isLayerTileUrl`.
- `src/services/TileCacheService.test.ts`: magic-hash runtime 404 + prefetch skip, hash-miss passthrough, empty-list bypass, `getCachedLayerStyle` rewrite.
- `src/services/tileCache/TileCacheRepository.test.ts`: composite key + `v3 -> v4` migration, delete-by-layer, evict-by-prefix.
- `src/services/TilePrefetchService.test.ts`: per-layer keying, `removeLayer`,
  target-removal races, shared/sole active ownership, retry cancellation, and
  durable-deletion failure.
- `src/services/tilePrefetchPlanner.test.ts`: meter padding, zoom ranges,
  dateline/root deduplication, zero-width bounds, and latitude clamping.
- `src/services/PreferencesService.test.ts`: `selectedMapLayerId` + `layerOfflineSync` normalization, forced-layer semantics.
- `src/controllers/SpeleoDBController.test.ts`: satellite-first ordering, `setLayerOfflineSync` enqueue/cleanup, offline skip.
- `src/pages/Settings.test.tsx`: Layers toggles (satellite forced) + per-layer %.
- `src/components/map/MapLayerControl.test.tsx` + `src/pages/Dashboard.test.tsx`: switcher, persistence, offline disable.

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
- **`crypto.subtle`** must exist in the iOS/Android WebView for the magic-hash
  check; if absent the check is skipped (tiles cached as-is, no crash).
- **Settings row centering** uses shadow-DOM `::part(native)`; verify rows are
  vertically centered (not top-heavy) on both platforms for single- and
  multi-line rows.
- **Removal under load**: while a project is actively prefetching more than one
  layer, quarantine/advance its commit and verify no new requests or job rows
  reappear for that target, while a URL shared by another target continues.

## Change checklist

1. Keep `MAP_LAYERS` the single source of truth for layer ids, labels, URLs, zoom.
2. Preserve satellite-first prefetch ordering and satellite-only project progress.
3. Keep the magic-hash check guarded (raster tiles only) and off the cache-hit path.
4. Route all tile requests through `cached-https` (offline + missing-tile check).
5. Run targeted vitest for touched paths + `npm run build`.
6. Update this document if layer behavior changes.
