# Keep browser preview assets stable during tests

Finish every command that can rebuild `dist/` before starting Playwright against
Vite preview. This includes pre-commit build hooks and native Gradle/Xcode
web-asset phases, not only explicit `npm run build` commands.

A concurrent build empties the output directory; a browser navigation can then
receive a real 404 before the new `index.html` is written. Treat that as a
verification orchestration error: preserve the trace, compare request and build
timestamps, remove the concurrent writer, and rerun the affected verification.
Do not hide it with test retries, longer timeouts, or weaker assertions.
