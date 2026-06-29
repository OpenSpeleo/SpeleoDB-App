# Untrusted error reflection

Server error messages are untrusted data, even when React escapes markup. An
authentication server, reverse proxy, or test tenant can echo submitted
credentials into `detail` or `message`, turning a harmless-looking UI error
path into a secret disclosure.

At the owning policy boundary, remove exact raw and encoded sensitive inputs,
neutralize control characters, and bound the result before publication. Keep
generic fallbacks for missing/empty shapes, and test absence of the original
secret rather than merely checking that a redaction marker appears.
