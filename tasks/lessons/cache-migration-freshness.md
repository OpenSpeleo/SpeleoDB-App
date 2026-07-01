# Preserve usable cache entries when metadata is missing

Adding freshness metadata to an existing cache must not turn every preserved
payload into an immediate network dependency. If the old schema has no fetch
timestamp, use the migration time as the conservative freshness baseline unless
product requirements explicitly demand revalidation.

When correcting a released or locally exercised migration, add a subsequent
schema version that repairs already-migrated records in place. Testing only the
old-schema-to-current path misses users whose database already contains the bad
intermediate value.
