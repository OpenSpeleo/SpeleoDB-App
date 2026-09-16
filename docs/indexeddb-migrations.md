# IndexedDB versioning and migrations

## Intent and scope

The offline-map database can evolve without discarding saved areas or downloaded
tiles. New releases must explicitly convert older data and verify preservation;
version numbers alone do not make arbitrary schema changes compatible.

This guide covers the local `speleo_tiles` IndexedDB database, not every
database or preference store in the app. It describes the current implementation
and the requirements for future changes. See
[tile-cache architecture](tile-cache-architecture.md) for storage ownership and
[offline download areas](offline-download-areas.md) for the catalog and product
behavior.

## Separate version numbers

| Value                   | Current                | Responsibility                                                       |
| ----------------------- | ---------------------- | -------------------------------------------------------------------- |
| `TILE_DB_VERSION`       | `9`                    | IndexedDB stores and indexes; database upgrade entry point           |
| Catalog `schemaVersion` | `1`                    | Shape and interpretation of the download-area JSON-compatible record |
| Catalog `revision`      | Changes with mutations | Tracks saved catalog changes, not schema migrations                  |
| Area `revision`         | Changes with bounds    | Tracks coverage changes for that area, not database structure        |

The catalog lives under key `download-areas` in store `offline_map_settings`.
Tile payloads, metadata, coordinate plans, generations and memberships live in
separate stores within the same database. The database version and catalog
version evolve independently: a new store requires a database upgrade, while a
new catalog format requires a reader/converter for that format.

Definitions:
[database constants](../src/services/tileCache/TileCacheRepository.ts) and
[catalog types](../src/types/downloadArea.ts).

## Database upgrades

`openTileDB()` calls `indexedDB.open('speleo_tiles', TILE_DB_VERSION)`.

- A new installation creates the current schema from database version 0.
- An older database triggers `onupgradeneeded`. The handler checks `oldVersion`,
  creates missing stores/indexes and performs applicable legacy conversions.
- A database already at the requested version opens without running that
  handler.
- Users can skip app releases. The handler must support a direct jump from each
  supported older version to the current version.

The schema upgrade runs in IndexedDB's version-change transaction. If that
transaction aborts, its changes and version increment roll back together. A
successful upgrade is retained; there is no automatic reverse migration later.

For example, v8 to v9 adds `offline_map_settings` without rewriting downloaded
tile bytes. Earlier upgrade branches backfill metadata, repair missing freshness
timestamps, and remove obsolete per-target job snapshots.

An open connection handles `versionchange` by closing and clearing the cached
connection promise, allowing another app context to upgrade. Database-open
failures also clear the cached promise so a later attempt can retry. Other
contexts must release their connections before an upgrade can finish; the
current repository has no dedicated `blocked`-event UI or timeout.

## Large data migrations and crash recovery

Large conversions should not scan all tile payloads inside the schema upgrade.
The existing `runOfflineMapV7Migration()` converts legacy v6 metadata/ownership
after opening the database, in batches of 250 records.

Its progress record, `__offline_map_v7_migration__`, is stored in
`offline_map_plans`. Each batch writes converted records and its progress cursor
in the same transaction. An interrupted batch rolls back; committed batches
remain, and startup resumes from the saved cursor. This is atomic per batch, not
one transaction covering the entire conversion.

The conversion preserves tile payload bytes and valid freshness timestamps,
supplies migration time only for missing/invalid timestamps, and converts legacy
owners to per-layer generations and memberships. Work yields between batches to
limit startup stalls. Engine startup waits for migration and recovery before
publishing usable coverage. This is an explicit migration implementation, not a
generic migration runner.

## Catalog upgrades and unsupported data

`readDownloadAreaCatalog()` validates and normalizes the catalog inside a
read/write transaction. Current compatible normalization assigns missing manual
area colors and removes obsolete manual names, persisting only when necessary.
Concurrent reads see consistent saved colors. These presentation changes retain
schema version 1 and do not change coverage revisions, generations or tile pins.
Legacy `visible` fields remain readable even though manual rectangle display now
follows the menu state.

`parseDownloadAreaCatalog()` accepts schema version 1 and validates area
records. Only an absent record is interpreted as a new empty catalog. A corrupt
record or unknown schema version raises an error; it is not replaced with empty
settings. This prevents an unreadable catalog from being mistaken for a request
to remove all offline coverage. Reads abort without overwriting the unsupported
record.

A future schema version 2 needs explicit version dispatch and conversion before
the current-format validator rejects old input. Changing the constant/type alone
is insufficient. Additive changes may keep version 1 only when their defaults,
validation and reader/writer behavior remain compatible; do not assume that an
optional field automatically makes every old writer safe.

Implementation:
[catalog repository](../src/services/tileCache/DownloadAreaRepository.ts) and
[catalog validator](../src/services/downloadAreaGeometry.ts).

## Compatibility and comparison with Django

New code reading older data is supported through explicit migrations: backward
compatibility. Old code reading newer data is not guaranteed: forward
compatibility. IndexedDB rejects opening an existing database with a lower
requested version (`VersionError`). Even if the database version is unchanged,
an older catalog reader rejects an unknown `schemaVersion`.

Reinstalling an older app is therefore not a supported schema rollback. Do not
delete the database as an automatic response to version errors: it contains user
area settings as well as reusable tile bytes. Downgrade support would require a
separately designed and tested compatibility/export/conversion path.

Like Django migrations, our code records a current version and applies explicit
conversions. Unlike Django, it currently has no numbered migration-file
registry, dependency graph, generated migration operations, general
applied-migration history, or reverse-migration command. Structural upgrade
logic lives in `TileCacheRepository`; the resumable conversion has its own
progress record; catalog normalization lives in `DownloadAreaRepository`.

## How to introduce a future change

1. Classify the change: stores/indexes, record format, compatible default, or
   data-only repair. Choose the appropriate database/catalog version boundary.
2. Preserve previous upgrade paths. Add structural changes to `onupgradeneeded`
   with a database-version increment; add record converters where needed.
   Account for both new installations and users skipping releases.
3. Keep small conversions transactional. For expensive work, persist progress
   atomically with each batch, make restart safe, and gate dependent readers
   until conversion is complete. Preserve tile bytes, freshness and shared
   ownership.
4. Repair already-upgraded installations explicitly. Editing an old upgrade
   branch does not rerun it for users already on that database version. Add a
   new upgrade/repair path; see the
   [freshness migration lesson](../tasks/lessons/cache-migration-freshness.md).
5. Test old fixtures through the production open/read/migration APIs and
   document the supported versions, performance cost, failure behavior and
   downgrade limits.

## Verification

Existing regression evidence includes:

- [TileCacheRepository tests](../src/services/tileCache/TileCacheRepository.test.ts):
  legacy database fixtures, payload/freshness preservation, ownership
  conversion, obsolete job removal and retry after a transient database-open
  failure.
- [DownloadAreaService tests](../src/services/DownloadAreaService.test.ts):
  concurrent catalog normalization, unchanged generation/pin ownership and
  rejection of unsupported catalog versions without clearing storage.
- [Geometry/catalog tests](../src/services/downloadAreaGeometry.test.ts):
  invalid catalog versions and records are rejected by the authoritative parser.

For each future migration, add applicable regression cases for fresh
installation, direct upgrades from supported versions, repeated opens,
interruption/transaction abort and restart, concurrent connections, unsupported
future formats, and preservation of saved intent, bytes and ownership. These are
verification requirements, not a claim that every possible migration scenario is
already tested. Run focused tests plus the repository's full validation. Startup
performance, native process termination and platform storage-pressure behavior
need appropriate device evidence; successful compilation or fake IndexedDB tests
cannot prove them.
