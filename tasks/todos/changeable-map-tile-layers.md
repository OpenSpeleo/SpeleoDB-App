# Changeable Map Tile Layers

Feature: website-parity changeable map tile layers (ESRI Satellite + ESRI
Hillshade light/dark) in the mobile app. See `docs/map-layers.md` for design.

## Tasks

- [x] Centralized `MAP_LAYERS` config + `MAP.MISSING_TILE_SHA256_HASHES`
      (`src/constants.ts`, `src/types/mapLayer.ts`); Mapbox dropped.
- [x] `MapLayersService.buildLayerStyle` +
      `TileCacheService.getCachedLayerStyle` (cached-https rewrite,
      offline-safe).
- [x] Magic-hash missing-tile detection (runtime 404 + prefetch skip) in
      `TileCacheService`.
- [x] `selectedMapLayerId` + `layerOfflineSync` in `PreferencesService`
      (satellite forced ON).
- [x] `layerId` on prefetch jobs; composite IndexedDB key + `v3 -> v4`
      migration; per-layer enqueue + `removeLayer`.
- [x] Controller: satellite-first prefetch, extra enabled layers at their max
      zoom; `setLayerOfflineSync` (immediate enqueue / cleanup).
- [x] Dashboard layer FAB + radio menu under My Location; persist + rebuild
      style; offline gating; satellite-only project progress.
- [x] Settings "Layers" section: per-layer toggle (satellite forced) + per-layer
      sync %.
- [x] Shared state (`selectedMapLayerId`, `layerOfflineSync`) in
      `AuthenticatedAppShell`.
- [x] Docs: `docs/map-layers.md` + updates to
      README/offline-mode/settings/networking.
- [x] Tests (unit + component) and verification (build, vitest, lint).

## Review

- Tiles stay URL-keyed (URL uniquely encodes layer + z/x/y) => zero-loss reuse
  of already-downloaded satellite tiles; only job keys are migrated.
- Satellite priority preserved by FIFO queue + scheduling order; project sync
  percentage remains satellite-only by design.
- Extra-layer prefetch reuses the same 500 MB cap + storage-consent override.
