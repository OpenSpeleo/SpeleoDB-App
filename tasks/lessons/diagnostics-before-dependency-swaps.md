# Diagnostics Before Dependency Swaps

When a user asks for logging or investigation, do not remove or replace a
dependency just because it is suspicious. Add phase-specific diagnostics first,
capture the concrete runtime error, and ask before making architectural or
dependency changes. Keep fixes proportional to the request.
