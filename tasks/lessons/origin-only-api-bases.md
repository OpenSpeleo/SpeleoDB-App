# Origin-only API bases

When services append fixed absolute endpoint paths, user-configurable base URLs
must be validated as origins rather than arbitrary URLs. Accepting a path,
query, or fragment and then concatenating an endpoint produces a different
request target than either the user or service intended.

Canonicalize once at the input boundary, use the same origin for transport and
persistence, and reject invalid input before credentials or authorization
headers reach the transport. Keep the parser in a pure module so business and
service layers do not acquire browser/plugin dependencies.
