# Transport deadline ownership

A request timeout is an end-to-end publication deadline, not merely a socket
option. It must begin before asynchronous request preparation and remain
authoritative through transport, body parsing, validation, and the final value
returned to the caller.

Never classify an abort as a malformed response. Broad parse-error handling must
re-check cancellation before returning a fallback body. Native transports that
cannot cancel underlying work must race it with the deadline, consume its late
settlement, and re-check the same signal before any delayed launch or
publication. Clear cached preparation promises after timeout so one hung plugin
call cannot poison every future request.

Every service wrapper that accepts request options must forward both the abort
signal and timeout. Dropping either option silently breaks ownership even when
the underlying transport is correct.

For binary raster validation, the same deadline must cover response headers,
body settlement, content-type/non-empty checks, and any configured digest. Race
each phase as one operation and consume late settlement; a header-only timeout
leaves pending bodies or hashing able to outlive their publication authority.
