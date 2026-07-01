# Rolling replacement inputs must be complete

A rolling replacement is safe only because the previous generation remains
active until the new one is complete. Silently converting a transient source
failure into an empty input defeats that guarantee: the smaller plan can finish
successfully and release valid coverage that was merely unreadable for a moment.

Classify inputs explicitly. Valid current records, valid empty datasets, and
durable current-version quarantines are resolved inputs. Read errors, missing
current versions, invalid cache contents, unverifiable identities, and stale
required geometry are incomplete inputs. Abort the replacement, preserve every
active generation, and test this at the coordinator-to-engine seam rather than
only testing each source loader in isolation.

Give collection attempts monotonic ownership as well as abort signals. Some
storage/native operations ignore cancellation; a final ownership check must
prevent an older collection from scheduling after a newer request has won.
