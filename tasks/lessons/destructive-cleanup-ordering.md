# Destructive cleanup ordering

Destructive logout, account deletion, and reset flows must revoke published
access before awaiting fallible teardown. Independent cleanup steps must all be
attempted even when an earlier native, persistence, or cache operation fails.

For split secret/non-secret state, remove the non-secret presence marker even
when secret deletion fails. Otherwise a restart can reinterpret a retained
secret plus retained marker as a valid session. Report a generic incomplete-
cleanup error only after every wipe step has run, and keep the operation
retryable.
