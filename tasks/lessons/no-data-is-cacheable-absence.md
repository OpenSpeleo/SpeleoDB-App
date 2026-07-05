# Cache authoritative absence separately from failures

A successful provider response whose content is a recognized no-data sentinel is
not equivalent to an HTTP error. Treating both as failures prevents finite sync
jobs from completing and repeatedly downloads an answer the client has already
verified.

Preventive rule: persist recognized absence as a payload-free, freshness-aware
tombstone. For offline generation work, commit the tombstone and ownership in
the same cancellation-validated transaction, then count the coordinate as
complete. Transport errors, HTTP errors, and invalid payloads must remain on a
separate failure path and must never create absence tombstones.
