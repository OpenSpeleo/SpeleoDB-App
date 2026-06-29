# Keep observers outside authoritative state results

Once a durable mutation and its owning state transition succeed, notification
subscribers and runtime adapters must not be able to change the operation's
result. If an observer exception bubbles through the command path, callers can
receive failure while storage and in-memory state already contain success.

Commit authoritative state first, treat observer hooks as best-effort effects,
and test throwing adapters at the owning seam. Durable storage, published
snapshot, and returned result must describe one coherent outcome.

Do not misclassify safety prerequisites as observers. Cancellation/invalidation
that prevents old-account work from crossing into a new session must complete
before durable commit; if it fails, reject setup without writing credentials.
Conversely, startup adapters and follow-up work launched after an authoritative
result are observers: their exceptions cannot crash restoration or reclassify a
successful transition.
