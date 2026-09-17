# Order access grants and denials by request identity

Concurrent collection and detail reads are not one atomic snapshot. Track read
order per resource for both successful access and confirmed denials. A global
completion counter can discard a newer denial when an older collection finishes
first; recording only successful reads lets a delayed collection resurrect a
resource that a newer request already denied.

Compare and advance access order in the same serialized state transition that
owns membership. Preserve the denial fence even when its persistence fails, and
allow a genuinely newer successful read to restore access. A storage failure
must not leave known-denied coordinates usable in memory.

Test both response arrival orders with deferred requests at the authority seam,
including durable cleanup, failed writes, absence of automatic detail retries,
and a subsequent legitimate regrant. See the
[GIS Geometry review](../todos/gis-geometry.md).

Monotonic content recovery must preserve access ordering too. If an atomic cache
write returns newer durable content after an interrupted prior write, merge the
latest accepted permission metadata onto that content before publication. Also
detach queued/in-flight identity deduplication on revocation: regranting an ID
must not reuse work belonging to its old access epoch. Keep old work tracked and
fenced until it settles.

Cached restoration is also an authority publication. A retry after startup
failure must use the same serialized publication lane as online commits;
otherwise its older asynchronous cache reads can overwrite newly accepted
content and access metadata even when all durable writes are correctly ordered.
