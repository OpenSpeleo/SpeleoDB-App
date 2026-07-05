# Roll Back Uncancellable Secure-Store Writes

## Lesson

Cancelling a caller does not necessarily cancel a native credential write.
Cancellation must remain authoritative at the transaction boundary, and logout
must wait for that transaction to settle before purge.

## Failure pattern

An older login can receive a valid token and begin a Keychain/Keystore write. If
a newer login or logout wins while that native write is in progress, merely
checking the cancellation signal afterward prevents state publication but leaves
the stale token durable. If the newer login then fails, the next startup can
restore credentials the UI never accepted. Purging concurrently is also unsafe
because the late write can repopulate storage after logout.

## Rule

- Give login attempts explicit latest-attempt ownership and pass their signal
  through transport and secure-session storage.
- Re-check cancellation after every asynchronous request-preparation boundary
  and immediately before launching a transport that cannot be interrupted.
- Let network work overlap, but serialize credential/metadata mutations.
- Snapshot the previous coherent session before mutation. If cancellation wins
  during or after an uncancellable write, restore both the credential and its
  metadata before releasing the mutation lane.
- Close login/validation admission before logout dispatches cancellation, then
  await all accepted authentication operations before destructive purge.
- Test transport cancellation, cancellation on both sides of metadata commit,
  rollback failure, concurrent login, and concurrent logout at their owning
  production seams.
