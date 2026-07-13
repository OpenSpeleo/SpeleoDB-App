# Instrumentation must preserve async boundaries

Timing, tracing, and logging are behavior changes when they wrap an existing
`await` in another async function. The extra promise settlement adds a microtask
boundary, which can change admission, cancellation, and supersession ordering
even when the measured duration is negligible.

For concurrency-sensitive orchestration, record the monotonic start time
synchronously before the existing `await` and record completion synchronously
after it. Track the active phase in the caller so the existing catch path can
report failure or abort without introducing another promise. Run the owning
cancellation and overlap tests, not only tests of the emitted diagnostic data.
