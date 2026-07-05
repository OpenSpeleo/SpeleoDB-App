# Revalidate persisted input at upgrade boundaries

Validation on new user input does not repair values written by older app
versions. Any persisted identifier that controls security, routing, ownership,
or storage selection must be revalidated when restored under the current policy,
before it is published or used for I/O.

Canonically migrate recoverable values before continuing. Reject and purge
unsafe values through the owning lifecycle boundary, and prove that no network
request or stale publication occurs first. Keep transport failures after a
successful migration separate from malformed-state failures so offline
continuity does not become destructive.
