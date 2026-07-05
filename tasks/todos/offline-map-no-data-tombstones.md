# Offline Map No-Data Tombstones

## Implementation gates

- [x] Represent a forbidden-hash response as a durable, zero-byte no-data
      tombstone without storing the provider payload.
- [x] Commit the tombstone and pending layer-generation membership atomically,
      then count that coordinate as completed synchronization work.
- [x] Serve fresh tombstones offline as an immediate missing tile and refresh
      stale tombstones without delaying the missing-tile response.
- [x] Keep HTTP errors, invalid responses, and transport failures on the failure
      path; in particular, a 404 must never become a tombstone.
- [x] Preserve cache statistics, ownership release, replacement, cancellation,
      and layer eviction semantics for tombstones.
- [x] Update tile-cache and map-layer documentation.

## Verification gates

- [x] Add authoritative repository, downloader, protocol, and engine regression
      tests.
- [x] Run focused tile repository/service/runtime/engine suites.
- [x] Run lint, typecheck, production build, and the complete CI suite.

## Review

Forbidden-hash responses now commit a `TileMetadataRecord.isNoData` tombstone
with `sizeBytes: 0`; the provider raster bytes are deleted/not retained. For an
offline-map download, the tombstone and generation membership share one
transaction that revalidates the pending generation and cancellation signal. The
downloader returns success only after that commit, so the engine advances
`completedTiles`. HTTP errors never enter this path.

Fresh tombstones are cache hits and produce an immediate `MissingTileError` with
zero network traffic, including offline. Stale tombstones keep returning the
null answer while refreshing in the background. Normal payload writes can
replace tombstones atomically, and generation release retains the unowned
tombstone as an ordinary freshness-aware cache entry.

Verification:

- `npm run test.unit -- --run src/services/tileCache/TileCacheRepository.test.ts src/services/TileCacheService.test.ts src/services/TileCacheService.runtime.test.ts src/services/TileCacheService.emptyHashList.test.ts src/services/OfflineMapSyncEngine.test.ts src/services/OfflineMapSyncEngine.repository.test.ts`
  — 6 files, 54 tests passed.
- Focused ESLint on all changed TypeScript files — passed.
- `npm run typecheck` — passed.
- `make ci` — 106 files, 1,781 tests passed with coverage; production build
  completed.

The metadata field is additive and normalized to `false` for existing records,
so no IndexedDB schema-version upgrade or payload migration is required. No
native code changed and no commit was created. The reusable distinction between
authoritative absence and request failure is recorded in
`tasks/lessons/no-data-is-cacheable-absence.md`.

### Adversarial correction (2026-07-01)

Hash provenance is layer-specific, not global: the known website fingerprint is
configured only for satellite and both hillshade lists remain empty. A
configured layer fails closed when SHA-256 is unavailable. HTTP errors, invalid
content types, empty bodies, and validation failures remain distinct from the
explicit raster/no-data outcome and cannot create tombstones. Payload and
tombstone commits now share the same in-transaction abort/generation checks, and
the repository regression uses real fake-IndexedDB transaction aborts for both.
The earlier command counts are historical; current results are logged in the
adversarial review.
