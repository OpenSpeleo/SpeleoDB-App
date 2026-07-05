# Untrusted error reflection

Server error messages are untrusted data, even when React escapes markup. An
authentication server, reverse proxy, or test tenant can echo submitted
credentials into `detail` or `message`, turning a harmless-looking UI error path
into a secret disclosure.

When the UI does not require server prose, do not publish it. Select a fixed
local message from a trusted status/error class and treat the response body as
opaque. Exact-value filtering is not a complete secret boundary: alternate
encodings, case variants, normalization, or a secret that overlaps the redaction
marker can defeat it.

Only retain untrusted text when product behavior genuinely requires it. In that
case use a schema-specific allowlist and prove the complete transformation
space; never claim arbitrary credential absence from a finite replacement list.
The same rule applies to thrown native/storage errors: when their prose is not
needed, log a fixed operation label and omit the raw error object entirely.
