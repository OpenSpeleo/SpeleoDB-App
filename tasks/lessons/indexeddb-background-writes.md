# Await the Durable End of Background IndexedDB Writes

## Lesson

A readable object-store value does not prove that its IndexedDB transaction has
finished. Tests for deliberately backgrounded writes must wait for the final
durable effect owned by the transaction.

## Failure pattern

The tile cache writes payload, metadata, and aggregate statistics in one
read/write transaction. A test waited only until the payload was readable, then
ended while metadata and statistics were still pending. The remaining work could
overlap later test setup. A worker-level fake IndexedDB singleton also allowed
databases and open connections to survive across serialized test files. Together
these leaks made identical coverage runs report different branches depending on
execution order and network timing.

## Rule

For fire-and-forget IndexedDB behavior:

- assert the user-facing result without forcing production to block;
- then wait for the last durable record or accounting update in the transaction;
- never use an intermediate store write or a generic microtask flush as proof of
  transaction completion;
- install a fresh fake IndexedDB factory per test file while preserving database
  lifetime within the file when persistence is part of the behavior under test;
- run the owning persistence suites under more than one deterministic shuffled
  seed when investigating order-sensitive evidence.

Cancellation must attach to the `IDBTransaction` itself, not only to checks
before and after an awaited helper. Abort the live transaction from the signal
and re-check cancellation/generation immediately before final metadata and
statistics writes. For stale-while-revalidate, also capture a cache/session
epoch: abort outstanding refreshes on clear/logout and reject a late transport
settlement even if the transport ignored abort. Exercise payload and tombstone
commits with a real fake-IndexedDB transaction abort, not a pre-aborted mock.
