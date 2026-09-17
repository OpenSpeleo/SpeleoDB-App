# Destructive cleanup ordering

Destructive logout, account deletion, and reset flows must revoke published
access before awaiting fallible teardown. Independent cleanup steps must all be
attempted even when an earlier native, persistence, or cache operation fails.
Published revocation must also survive notification/runtime-adapter exceptions;
those hooks are best-effort effects, not prerequisites for denying access.

For split secret/non-secret state, remove the non-secret presence marker even
when secret deletion fails. Otherwise a restart can reinterpret a retained
secret plus retained marker as a valid session. Report a generic incomplete-
cleanup error only after every wipe step has run, and keep the operation
retryable.

Retries must preserve accepted runtime denial when persistence failed; rereading
an older disk catalog can grant revoked access again. Empty runtime membership
does not mean pending durable cleanup is complete. Replay that cleanup on
explicit retry, and cover both startup and normal-operation recovery.

Cancellation is a request to stop, not proof that work settled. A backpressured
producer must join its admitted workers on error as well as success before
idleness or destructive cleanup can be reported. Replacement scheduling must
include draining workers in its concurrency limit.
