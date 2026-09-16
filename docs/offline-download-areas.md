# Offline download areas

## Intent and audit

Users can prepare a destination before a trip without creating a project or
landmark. The same rectangular `DownloadArea` is the unit of intent for manual
selections and automatic coverage. This avoids separate download, cancellation,
pinning, and storage policies for different kinds of map objects.

The previous implementation already included validated project GeoJSON bounds,
cached landmarks and surface/subsurface stations, saved local GPS tracks, and
current-SHA remote GPS tracks. Display visibility did not control downloading.
GPS coverage followed a narrow corridor; it now uses one bounding rectangle per
track. Two gaps were corrected: pending landmark changes are folded into source
geometry, and landmark mutations now schedule preparation. Exploration leads and
cylinder installs also pass through the shared point adapter.

| Source                               | Rectangle                                      | Layers                        | User controls                         |
| ------------------------------------ | ---------------------------------------------- | ----------------------------- | ------------------------------------- |
| Manual                               | Exact selected corners                         | Satellite plus enabled layers | Add, show/hide, edit boundary, delete |
| Project                              | Validated current-commit GeoJSON bounds + 50 m | Satellite plus enabled layers | Source-owned, hidden                  |
| Landmark / station / lead / cylinder | Point bounds + 50 m                            | Same shared preferences       | Source-owned, hidden                  |
| Local / remote GPS track             | Entire track bounds + 50 m                     | Same shared preferences       | Source-owned, hidden                  |

Every area covers zoom levels 0–18. Longitude intervals can cross the dateline;
latitude is limited to Web Mercator. A constant-space preflight rejects manual
areas exceeding 1,000,000 coordinates before persisting or enumerating tiles. An
oversized automatic area reports a problem without blocking other areas. A long
track can consequently exceed the limit; users can create smaller manual
selections to prepare specific sections. No maximum-zoom reduction happens
silently. Polar source latitudes are clamped to the map before padding so they
retain a valid edge strip and cannot reject unrelated sources in the same
catalog update.

## Interaction design

The map's download button sits directly below Layers in a shared vertical stack.
Location, Layers and Downloads share circular 44-pixel controls and solid fills;
the stack applies the safe-area inset once. The layer menu appears above the
download control. This button and **Settings → Offline Maps** open the same
bottom sheet. It is a single list with no detail screen. Each saved area has a
persistent color, a short positional label (Area 1, Area 2, …), a download
status, and three 44-pixel icon actions in order: **show/hide**, **edit
boundary**, **delete**. Delete is red and opens an inline confirmation with
Cancel/Delete. The labels are display positions, not user-entered names or
identifiers. Colors and UUIDs remain stable when other areas are removed.
Automatic areas stay out of this manual-area list.

**Add new offline area** is always available in the list. It opens a crop frame
over the live map. Pan/zoom beneath it or drag any of four 44-pixel corner
targets; arrow keys refine a corner, with Shift moving ten pixels. The editor
has no name or coordinate fields. Its bottom sheet has a quiet size estimate and
just **Cancel / Save**, whether adding, editing, online, or offline. Cancel
immediately discards the local draft; only Save writes settings and schedules
downloads. Save returns to the list, making consecutive additions
straightforward. Editing one rectangle leaves every other area untouched.

The map header is guidance only. Other map controls and the tab bar hide during
selection. Downloadable draft bounds survive viewport resizing; oversized drafts
keep a usable frame instead of attempting an impossible Mercator/zoom fit.
Editor activation and tab-bar hiding are committed together. The editor measures
in a layout effect and synchronizes MapLibre's size before fitting/projecting
the frame. Its fitting region also leaves room below the measured safe-area
header so corner targets stay tappable. Only map movement carrying a user
`originalEvent` or explicit corner refinement changes draft coordinates. Resize
and programmatic camera movement reproject the frame from the existing
geographic bounds, so Edit → Save without a gesture preserves exact coordinates
and does not start a replacement download. The estimate uses aggregate bytes per
cached tile when available, otherwise 32 KiB per tile. It includes the enabled
layers and is approximate: provider imagery varies and overlapping downloads
reuse payloads.

Each new area receives a random color from a curated bright palette, preferring
unused colors and balancing reuse after the palette is exhausted. The same color
appears in the list, map fill/outline, and existing-area selection boundary. A
shared neutral diagonal stripe texture adds contrast over the colored fill;
there is no image or map source per area. Wrapped rectangles render as two
polygons. Visibility changes presentation only, never download ownership.

There are no Retry or Refresh buttons in the manager. Saving an incomplete area
also resumes its existing download; unchanged complete areas do not redownload.
Existing foreground/reconnection scheduling remains authoritative. Offline Save
persists immediately and the app's **Go Online** flow starts waiting work.
Deletion commits catalog removal and marks generations for release atomically,
then cleans up tile memberships and refreshes cache statistics. The manager
unlocks other actions as soon as the authoritative catalog removes the area; it
does not wait for tile cleanup. Pending operations and confirmation completion
are keyed by area ID so an older deletion cannot dismiss or unlock a newer one.
A failed catalog write keeps the area and its confirmation visible. Cleanup
still completes through the existing service promise, retaining shared pins and
reusable bytes until normal eviction.

## Data model and ownership

`src/types/downloadArea.ts` defines the enum and JSON-compatible catalog:

```json
{
  "schemaVersion": 1,
  "revision": 12,
  "layerIds": [
    "esri-satellite",
    "esri-world-hillshade",
    "esri-world-hillshade-dark"
  ],
  "areas": [
    {
      "areaId": "generated UUID",
      "objectId": null,
      "type": "manual",
      "topLeft": [2.0, 46.001],
      "bottomRight": [2.001, 46.0],
      "color": "#22d3ee",
      "visible": true,
      "layerIds": [
        "esri-satellite",
        "esri-world-hillshade",
        "esri-world-hillshade-dark"
      ],
      "revision": 1,
      "sourceKey": "manual:generated UUID",
      "sourceRevision": null
    }
  ]
}
```

Manual areas have no `name`; automatic areas may carry their source's label.
Color is presentation metadata, not part of coverage identity. On first read,
`readDownloadAreaCatalog` upgrades older manual entries inside one IndexedDB
read/write transaction: assign missing colors, remove obsolete names, and
persist once. Concurrent startup reads see the same colors. Schema version 1
remains compatible, and catalog/area revisions, generation records and pins are
unchanged.

Coordinates are `[longitude, latitude]`. `objectId` holds the source's ID when
available (anonymous GeoJSON points may lack one). `sourceKey` supplies stable
identity across reconciliation, including separate local/server track domains.
`sourceRevision` records source provenance; area `revision` changes only when
bounds change. Layer switches never increment an area revision. Renaming and
visibility never invalidate coverage. Catalog revision tracks persisted
mutations independently.

One `download-areas` record in the `offline_map_settings` IndexedDB store holds
these local user settings. This is intentionally outside small localStorage
preferences: catalog writes and generation invalidation must share a database
transaction. It is not synchronized between devices. Tile bytes and per-tile
memberships remain in their existing stores, outside the catalog JSON. Parsing
fails closed on unsupported/corrupt catalogs rather than treating them as empty.
Signout clears the catalog with the tile database.

- `downloadAreaSources.ts` converts authoritative domain sources to rectangles.
- `downloadCoverage.ts` gives every rectangle the same layer-independent
  geometry identity and builds the canonical union input. Source type, ordering,
  names, colors, visibility and enabled layers do not enter this identity.
- `DownloadAreaRepository` owns catalog transactions and atomic activation of
  all enabled layers for the union. Catalog edits mark obsolete pending
  ownership for release in that same transaction.
- `DownloadAreaService` owns one shared plan and a serial layer queue, CRUD,
  reconciliation, aggregate progress, foreground suspension, and legacy-pin
  retirement.
- `TileCoordinator` validates automatic source completeness, source-read
  supersession, preferences and storage consent; it delegates all downloads.
- `OfflineMapSyncEngine` continues to own planning, audit, bounded requests,
  retries, durable checkpoints, and tile membership claims.

The service's storage and planner imports are deferred until use, preserving the
login/startup bundle boundary. The public controller façade exposes snapshot /
subscribe, save, visibility, delete, retry, and foreground lifecycle operations.
React reads the dedicated snapshot through `useDownloadAreas`.

## Replacement, overlap, recovery and migration

Each rectangle generates coordinates at zooms 0–18. The existing worker combines
these coordinate streams, deduplicates them, and persists one immutable union
plan. Layers reuse its chunks; they do not enumerate geometry. Only a change to
the set of rectangles invalidates this plan. The same persisted plan also serves
reconnection, refresh, restart and re-enabling a layer. Identical rectangles
share the same identity even when their source IDs differ.

Layer preferences live once on the catalog (`layerIds`) and apply to **all**
areas. Legacy per-area `layerIds` are mirrored for compatibility, not used to
plan separate scopes. Startup reconciles the catalog with Settings preferences.
Satellite remains forced. Enabling a layer queues only that provider. Disabling
it invalidates/releases its claims and cancels it if it is currently running;
other providers keep their generations, progress and in-flight requests. A
switch does not cancel a pending source read: reconciliation reads the latest
layer intent inside its catalog transaction. Settings merges concurrent switch
completions instead of replacing the other switches with stale React state.

Generations carry the canonical `coverageKey`, with one membership per unique
URL per layer. New geometry keeps previous active coverage until every enabled
replacement layer succeeds. `activateDownloadCoverage` checks current geometry,
layer preferences and durable completion in one transaction. A failed layer
keeps the old coverage active. Late work for deleted or superseded intent cannot
recreate claims. Deleting one overlapping area replaces the union, or does no
work when its rectangle is still contributed by another area. Cached payloads
are retained for normal eviction after the final claim is released.

Schema v9 and catalog schema version 1 remain compatible. Existing migration and
recovery still run. Old per-area and pre-area generations remain pinned until
authoritative source reconciliation and complete union replacement; failed
source reads preserve them. Migration reuses cached bytes rather than clearing
the cache.

Startup recovers committed intent, active manifests and cached bytes. Area
creation waits for the shared recovery promise before admitting generations, so
recovery cannot mistake new work for interrupted work. Logout also awaits that
recovery promise before clearing storage. Interrupted pending generations are
released by existing recovery and rebuilt from saved intent; already downloaded
fresh bytes are reclaimed locally. Foreground loss cancels in-flight work, and
foreground return resumes the queue. Logout disposes both service and engine,
waits for idleness, then clears storage. Durable intent is never inferred from a
partially collected set of automatic sources.

## Performance and verification

One active layer uses the existing six download workers and 64-coordinate queue;
adding areas does not multiply network concurrency. The existing worker planner,
2,048-coordinate chunks, 16-coordinate audit batches, one-second checkpoint
cadence and paint-driven progress remain. The catalog is written on user/source
changes, not per tile. Counting a selection needs only 19 zoom iterations.

Geometry planning is independent of layer scheduling. The worker merges
rectangle tile ranges by vertical strips and emits sorted, deduplicated chunks.
Its memory scales with the number of areas, not the total tile count. The
existing 1,000,000 limit remains per area; combining valid areas imposes no new
aggregate limit. No layer toggle changes scope or silently reduces zoom.
Rectangle preflight remains constant-space. Layer totals are the unique union
count, never summed per-area ownership counts. Progress is merged across enabled
layers in the service's dedicated sync store, so moving to the next provider
does not reset completed providers. Already-ready unchanged rectangles retain
their downloaded status while another is edited; unfinished areas show progress
for the shared batch. The UI estimate uses the current enabled-layer count.

Regression evidence includes real engine + IndexedDB tests that count worker
calls and unique network URLs, hold transport/source reads across rapid
switches, verify unchanged generation IDs and completion counts, restore plans
after restart, and prove all-layer replacement safety. Browser checks exercise
actual workers, Settings toggles and persisted plans in Chromium and WebKit. See
[the layer stability review](../tasks/todos/offline-layer-stability.md).

Automated evidence lives at the owning seams:

- `DownloadAreaService.test.ts`: real engine and fake IndexedDB for sharing,
  multiple unnamed areas, persisted colors and legacy migration, offline edits,
  all-layer replacement failure, deletion during ignored abort, layer changes,
  stable identity, migration, foreground lifecycle and signout.
- `downloadAreaGeometry.test.ts`: preflight/planner agreement, dateline/world
  bounds, catalog validation, source types and full-track rectangles.
- Controller tests: complete/current source inputs, stale collection rejection,
  automatic scheduling and layer preferences.
- `OfflineMapsPanel.test.tsx`: manager/editor interactions, map-derived bounds
  and keyboard input, offline saving, direct cancellation, and persistence
  errors.
- `DownloadAreaMapLayers.test.tsx`: actual Source prop injection, wrapped
  geometry, hidden/automatic filtering and style pattern restoration.
- `tests/browser/offline-maps.spec.ts`: shipped production UI, real IndexedDB,
  WebKit/Chromium, multiple areas and color stability, row action ordering,
  small-screen touch targets, fixture transport and a narrowly emulated native
  vault bridge.

See [the implementation review](../tasks/todos/offline-download-areas.md) for
exact executed commands and limitations. Browser fixtures do not establish
physical iOS/Android WebView behavior. Release verification must still cover
real touch pan/pinch/handles, airplane-mode rendering of each layer, app kill /
relaunch during replacement, storage pressure/consent, and background/foreground
transitions on both devices. Native builds establish compatibility, not those
runtime guarantees.
