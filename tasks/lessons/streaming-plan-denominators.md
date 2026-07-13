# Do not expose partial planner counts as final totals

Streaming planners publish partial work by design. Summing their current batch
counts into a user-visible denominator makes progress move backward or jitter,
even when the underlying downloader is correct.

Derive expected totals from a stable invariant whenever one exists. For map
layers with identical coordinate coverage, use the settled reference-layer tile
count multiplied by enabled layer count. Let streamed jobs update completed work
only; they must not redefine the final denominator while planning is active.

Batching across a worker boundary is not permission to create a long downstream
head-of-line delay. Use a small bounded handoff batch, publish in-memory
progress on a short time bound, and keep durable persistence checkpointed
separately. Do not start a storage-writing consumer from inside the storage
audit loop: on real IndexedDB implementations that can starve both sides even
when simple mocks pass. UI smoothness must not require per-item IndexedDB job
writes.

Rolling replacement jobs may reset internal counters even though old payloads
remain valid. A coverage UI must model that retained availability: freeze its
reference denominator while replanning and never decrease displayed completion
for an unchanged layer scope.

Do not independently trust both aggregate and per-layer completion counters in
the UI. Derive the aggregate numerator from the same bounded per-layer values
that are rendered, and clamp persisted progress to its declared total. Otherwise
an over-count in one generation can mask a deficit in another and produce a
simultaneous overall 100% and per-layer 99% display.

Worker placement alone does not make planning bounded. If physical-device
timings show that per-coordinate durable deduplication dominates, a worker-local
packed `Set<number>` is appropriate only with an explicit unique-coordinate
ceiling and a documented memory envelope. Finish deduplication before publishing
the denominator, sort in a typed array, transfer final chunks with one-chunk
durable acknowledgement, and commit the immutable manifest last. Never replace
storage amplification with an unbounded set, ordinary-object coordinate array,
or unacknowledged message backlog. Bound downstream ready and delayed work
separately from active workers and record their measured high-water marks.

Worker fallbacks do not prove the production message protocol. A test suite can
exercise all planning math while the real worker silently rejects an
undiscriminated request. Cover the actual `Worker` branch and assert every
request/response discriminant plus acknowledgement; otherwise a protocol typo
can leave the caller pending forever with no worker error to surface.
