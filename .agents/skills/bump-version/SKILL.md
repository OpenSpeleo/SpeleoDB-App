---
name: bump-version
description: >-
  Update SpeleoDB's native app version to a user-specified X.Y.Z, prepare the
  release changelog with a fresh Unreleased section, and commit all release
  edits together. Use for requests such as "Update version to X.Y.Z using
  $bump-version" or "Bump the version to 1.6.2 using this skill." Run no tests,
  checks, hooks, or scripts.
---

# Bump SpeleoDB's version

Complete a small release-metadata edit and make **one commit containing both the
version bump and the changelog**. This is the user's explicitly requested
version-bump workflow: the usual full-verification process and separate
`[Changelog Update]` commit do not apply here.

## Input and scope

- Take the exact `X.Y.Z` version from the user's request. Do not choose the next
  version yourself. If the version is missing, ask only for that value.
- Use the current local date as `YYYY-MM-DD`, unless the user supplies a release
  date. Do not copy the date from an older release.
- Work in this repository. Read the native version settings and the beginning of
  `CHANGELOG.md`. Minimal Git inspection is allowed to identify existing edits
  and avoid capturing unrelated work.
- This skill edits and commits release metadata. It does not create tags, push,
  publish a GitHub release, or upload to mobile stores unless separately asked.

## No tests, checks, hooks, or scripts

**Do not run checks before or after these edits.** In particular:

- No unit, integration, browser, native, or coverage tests.
- No `prek`, pre-commit hooks, lint, type checking, builds, dependency audits,
  inventory checks, formatters, validators, or `git diff --check`.
- No Capacitor sync, dependency installation or updates, Android Studio,
  emulators, Xcode builds, signing, or release-ceremony execution.
- No repository scripts, generated helper scripts, inline Python/Node code,
  shell automation scripts, or skill-validation scripts.
- Do not investigate or fix unrelated failures discovered in an earlier run. Do
  not launch a review agent or add a task plan/report for this routine edit.

Use direct file edits, such as `apply_patch`, and direct Git commands. Reading
the relevant files and inspecting the intended diff are permitted; they are not
an invitation to run an automated verification workflow. Disable Git hooks for
the commit itself using the command-local setting shown below. Do not change the
repository's persistent hook configuration.

## 1. Update both native versions

The native version is authoritative. The root npm package version is tooling
metadata and must not be changed as part of this workflow.

| File                                    | Human-readable version       | Integer build number           |
| --------------------------------------- | ---------------------------- | ------------------------------ |
| `android/app/build.gradle`              | `versionName "X.Y.Z"`        | `versionCode N`                |
| `ios/App/App.xcodeproj/project.pbxproj` | `MARKETING_VERSION = X.Y.Z;` | `CURRENT_PROJECT_VERSION = N;` |

Use the same human version and build number on both platforms. Update every app
Debug and Release occurrence in the Xcode project, not just the first matching
line. Currently there are two occurrences of each iOS setting and one occurrence
of each Android setting.

Determine the build number from the local release convention:

- If the user supplies a build number, use it consistently on both platforms; it
  must increase beyond the previous release's native build numbers.
- Otherwise, the preferred number is the integer formed by removing the dots
  from the requested version: `1.6.1` becomes `161`, `1.6.2` becomes `162`, and
  `1.7.0` becomes `170`.
- If that preferred number would not increase beyond the previous release's
  highest Android/iOS build number, use that highest number plus one. Do not
  reuse or decrease a release build number.
- If this exact release is already consistently prepared in the working files,
  retain its prepared build number instead of incrementing it again. Use the
  committed previous release to distinguish an existing preparation from a
  genuinely new bump. Do not query store APIs.

For example, the `1.6.0 (160)` to `1.6.1 (161)` change is:

```text
android/app/build.gradle:
    versionCode 161
    versionName "1.6.1"

ios/App/App.xcodeproj/project.pbxproj, both Debug and Release:
    CURRENT_PROJECT_VERSION = 161;
    MARKETING_VERSION = 1.6.1;
```

`ios/App/App/Info.plist` already references `$(MARKETING_VERSION)` and
`$(CURRENT_PROJECT_VERSION)`; preserve those references. Keep the iOS 16.4
deployment floor and Android WebView settings unchanged. Do not change Gradle
plugin versions, dependencies, generated Swift packages, lockfiles, identifiers,
or signing settings. The older example commit `7e37749` included an incidental
Gradle plugin change; that is not part of the version-bump procedure.

## 2. Roll the changelog forward

Move the existing `Unreleased` release notes into a new section immediately
below a fresh, empty `Unreleased` scaffold. The release heading is exactly:

```markdown
## vX.Y.Z - YYYY-MM-DD
```

The top of `CHANGELOG.md` must retain its title and introduction, followed by:

```markdown
## Unreleased

### Features

### UI/UX

### Fixes

### Performance

## vX.Y.Z - YYYY-MM-DD
```

All four empty subsections under `Unreleased` are required, including
`Performance`. Do not remove them because they contain no entries.

Under the new version heading:

- Preserve the former Unreleased entries and their populated categories,
  including categories such as `Changes` when present.
- Preserve the short implementation commit IDs at the ends of the entries. Do
  not replace them with the version-bump commit ID.
- Keep the notes concise and customer-facing. Do not add test results, build
  details, internal refactors, or an entry merely announcing the version bump.
- Omit empty categories inside the released section. Do not invent release notes
  when Unreleased is empty.
- Leave all older version sections intact. Do not duplicate the target version
  heading if the requested release has already been prepared.

## 3. Commit everything from this release edit together

Commit the two native version files and `CHANGELOG.md` in **one commit** named:

```text
[Version Bump] vX.Y.Z
```

The changelog belongs inside this commit. Do not make a separate
`[Changelog Update]` commit, and do not leave the changelog uncommitted.
"Everything" means all changes made for this release task; unrelated user work
must not be swept into the commit. Stage explicit paths rather than
`git add -A`.

Run these direct Git commands, substituting the requested version:

```bash
git add -- android/app/build.gradle ios/App/App.xcodeproj/project.pbxproj CHANGELOG.md
git -c core.hooksPath=/dev/null commit --only -m "[Version Bump] vX.Y.Z" -- android/app/build.gradle ios/App/App.xcodeproj/project.pbxproj CHANGELOG.md
```

The explicit commit paths prevent unrelated staged files from being included. If
unrelated edits share one of these files, preserve them and stage only the
release edits; do not use the whole-file command to absorb them. In that case,
also preserve unrelated staged changes rather than committing them implicitly.

If the user asks to amend, include the changelog in the version-bump commit and
retain the `[Version Bump] vX.Y.Z` message. If this task accidentally created
two local commits, consolidate only those task-owned commits after confirming
their identities. Do not rewrite unrelated commits or force-push. An already
completed release with no pending edits does not need an empty duplicate commit.

## Completion message

Report the version, shared build number, and single commit ID. Confirm that the
changelog includes the release notes and the empty Unreleased subsections. Say
that tests and checks were not run, as requested. Do not claim verification or
publication that this workflow does not perform.
