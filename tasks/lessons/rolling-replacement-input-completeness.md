# Preserve unresolved intent without blocking healthy sources

A rolling replacement is safe only when its union includes all retained intent.
Converting a failed read into an empty source can release valid coverage. Making
every source a global prerequisite also breaks fresh installs: one optional API
failure can leave all tile counts at zero.

Represent authority per source type (or per identity when the provider supports
it). Replace authoritative inputs, retain saved rows for unresolved inputs and
plan their combined union. A valid empty collection can remove rows; a transport
failure cannot. A slow source type must not delay publication of any ready type,
regardless of which feature introduced it. Keep the number of publications
bounded and use the same catalog/engine.

Pre-area legacy generations lack reconstructable rectangle ownership. Keep their
pins until every automatic source is authoritative and the new union completes.
Check source freshness inside the catalog transaction; targeted revocation must
not cancel unrelated preparation. Retain monotonic collection ownership and
abort checks so late storage/native operations cannot supersede newer intent.

Test clean-cache nonzero progress before releasing delayed or failed optional
reads, saved-row preservation, recovery, revocation and legacy pins at the real
catalog/engine seam. Do not encode a global freeze as the expected regression
behavior. See [the GIS tile correction](../todos/gis-tile-sync-regression.md).
