# Online cache hits must not depend on network settlement

If a resource is usable from durable cache, being online must never insert a
network await before that cache read can resolve. “Network first with cache
fallback” turns slow connectivity into worse behavior than airplane mode and can
leave a render surface blank indefinitely.

Preventive rule: test the production protocol/loader seam with a permanently
pending network mock. A fresh cache hit must resolve and the mock must have zero
calls. Stale-while-revalidate tests must prove the stale result resolves before
refresh settlement and that a failed replacement preserves the old bytes.
