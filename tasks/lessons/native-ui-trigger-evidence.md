# Separate Native UI Identity from Trigger Proof

Recognizing a system-owned alert proves which platform subsystem rendered it; it
does not prove the input sequence, responder state, or lifecycle transition that
caused it to appear.

- Treat platform documentation as evidence for the UI's ownership and candidate
  triggers, not as a substitute for reproducing the reporter's exact context.
- Preserve contradictory evidence such as "no keyboard was visible" or "touch,
  not motion, seemed involved" in the root-cause record instead of explaining it
  away.
- Label safety policies that block documented triggers as guardrails until the
  original scenario has a red-before/green-after reproduction at the owning
  native or WebView seam.
- Property and compilation tests prove configuration. Physical-device evidence
  is still required for system gesture recognition and native modal behavior.
- For WebView editing, inspect the active DOM input responder rather than
  assuming a public `WKWebView` or controller owns the responder property being
  configured. An ancestor property assertion is not gesture-behavior evidence.
