# Refresh iOS Package Modules After Header Changes

When Swift Package Manager changes a package checkout or binary artifact,
Xcode's cached explicit module can still describe the previous headers. The
result is an error saying a framework header was modified after its `.pcm` was
built; changing application source code cannot fix that cache mismatch.

- Remove only the affected project's named DerivedData directory, not global
  Xcode caches or repository files.
- Run `xcodebuild -resolvePackageDependencies` to repopulate local products and
  binary XCFramework artifacts before rebuilding.
- If the first clean build reports a missing artifact zip while packages are
  being reconstructed, let package resolution finish and rerun the build.
- Verify with the same normal DerivedData location and signed destination used
  by the Xcode IDE; a separate temporary DerivedData build does not prove the
  IDE cache was repaired.
- Do not disable explicit modules, edit dependency headers, or change package
  versions merely to hide a stale-module diagnostic.
