# Performance claims require wall-clock evidence

Operation counts, asymptotic complexity, concurrency, and automated correctness
are useful diagnostics, but none proves that a user-visible path became faster.
Shared storage contention, structured-clone cost, garbage collection, rendering,
worker startup, scheduling, and device-specific WebView behavior can reverse an
apparently beneficial optimization.

Before claiming a performance improvement:

1. Define the user-visible start and terminal boundaries.
2. Run the same representative workload against the pre-change baseline and the
   candidate implementation.
3. Record raw wall-clock samples, median, worst result, time to first useful
   publication, long-task behavior, and retained ownership of large payloads.
4. Add safe production phase timings for physical-device confirmation when a
   desktop benchmark cannot model the platform.
5. Treat operation-count reductions only as supporting evidence. If wall-clock
   or responsiveness regresses, revert or redesign the optimization regardless
   of its theoretical improvement.

Load-sensitive build-performance advisories do not belong in artifact tests
whose contract is unrelated to build speed. Disable that exact advisory through
the build tool's scoped configuration for the test invocation; do not mute
`console.warn`, weaken the repository console guard, or disable the advisory in
normal production builds.
