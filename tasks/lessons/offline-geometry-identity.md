# Keep geometry identity separate from download policy

Changing an enabled provider must not revise area geometry, rebuild coordinate
lists, cancel unrelated transfers or reset their progress. Derive plan identity
only from the canonical rectangles and zoom policy. Deduplicate their union
once, persist it, and let each enabled provider reuse the same chunks.

Source collection and preference commits have separate ownership. Commit source
geometry against the latest saved layer preference; a toggle must not discard an
otherwise current source read. Merge concurrent React preference updates rather
than copying a stale object after an asynchronous save.

Prove this with real planner/engine/storage tests: count planner calls and
unique URLs, hold network and source reads across toggles, assert unchanged
generation IDs and progress, and verify stale work cannot commit after deletion.
Browser tests must cover the real worker branch. A cache hit alone is
insufficient if every toggle still rebuilds plans, audits unaffected layers or
recreates claims.

When combining formerly separate work, preserve its capacity contract. A bounded
per-area limit must not accidentally become a stricter aggregate limit.
Streaming sorted rectangle unions can bound memory without keeping a set of
every tile.
