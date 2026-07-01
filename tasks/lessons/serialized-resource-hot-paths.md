# Keep correctness bookkeeping off per-resource hot paths

Durable ownership, aggregate statistics, retry state, and crash checkpoints are
important, but routing every downloaded resource through one application-level
promise chain turns independent network and IndexedDB work into a serial queue.
It also makes UI progress arrive in bursts when checkpoint writes finish.

Preventive rule: let the storage engine provide transaction ordering, keep a
bounded pool of independent network workers, and publish live in-memory progress
separately from durable checkpoints. Tests must prove maximum concurrency,
head-of-line avoidance, per-resource state transitions, and that unrelated UI
subscribers do not receive progress notifications.

A dedicated controller observer is not enough if its snapshot is then embedded
in a shared React context value: each update still fans out to every context
consumer. High-frequency progress must be consumed through its own
`useSyncExternalStore` hook (or a separate narrow context), with a render-count
test proving unrelated consumers remain untouched.
