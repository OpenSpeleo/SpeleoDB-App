# Sync wall-clock benchmark

Run the cache-to-Dashboard benchmark with explicit garbage collection:

```sh
node --expose-gc node_modules/vitest/vitest.mjs run \
  --config benchmarks/vitest.config.ts
```

The workload seeds 60 validated projects with 2,000 three-dimensional point
features each (about 18 MiB of GeoJSON), then records five samples for:

- time to the first useful project publication;
- cold time until all 60 projects are published;
- same-session revision reload time;
- mounted heap growth after explicit garbage collection.

It also runs the full post-network project path three times: project-list
publication, worker-equivalent validation, durable IndexedDB writes, phase
completion, and maximum event-loop timer delay. Network responses are immediate
so the measurement isolates local work after the downloads have arrived.

Use the identical benchmark file and dependency lock against both the target
commit and its pre-change baseline. Report raw samples, median, and worst-case
values. This desktop/fake-IndexedDB workload is a comparative regression gate,
not a substitute for the native aggregate timings or physical-device evidence.
