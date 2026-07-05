# React async action ownership

Disabling a button through React state does not synchronously close admission:
multiple events can reach the same handler before the next render. Async form
and destructive actions need a ref-backed admission gate set before their first
state update.

The component that starts an async action also owns its publication and timer
lifecycle. Ignore completions after unmount, clear delayed callbacks during
cleanup, and keep admission closed through any success-to-navigation window.
Test duplicate same-turn events and unmount with the real component handler;
button appearance alone is not concurrency evidence.
