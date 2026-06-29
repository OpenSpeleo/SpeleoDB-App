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
