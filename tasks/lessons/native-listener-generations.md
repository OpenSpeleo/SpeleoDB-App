# Retire native callbacks before asynchronous teardown

## Failure pattern

The compass service cleared its cached heading when the final consumer left, but
the bridge callback stayed registered while native stop awaited completion. An
in-flight event repopulated that cache, and a later subscriber received an
obsolete heading. A callback queued by an already removed listener could also
overwrite a fresh session's reading. Tests that only asserted start/stop counts
missed both failures.

## Preventive rule

For shared native subscriptions, give each listener a generation and invalidate
it before awaiting stop/removal, including cancelled or failed startup. Reject
callbacks from retired generations and avoid caching readings with no consumers.
Preserve a still-valid shared listener when subscribers briefly leave and return
before reconciliation. At the real service boundary, hold bridge promises open,
deliver old callbacks during and after teardown, then assert both the resumed
consumer's initial state and its current reading.

Evidence and corrective scope: [compass review](../todos/map-compass-review.md).
