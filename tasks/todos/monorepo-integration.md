# Monorepo integration

## Plan

- [x] Preserve the mobile repository's standalone npm lockfile contract.
- [x] Use an npm-valid package name so the root workspace can discover mobile.
- [x] Declare build/test imports that nested npm installs cannot borrow
      transitively.
- [x] Make its lockfile hook ignore an enclosing npm workspace.
- [x] Verify standalone and root-workspace installs and builds.

## Review

Both `npm ci --workspaces=false` in this subtree and root `npm ci` complete
successfully. Standalone lint/build use the subtree lock (Vite 8.1.4); root
lint/build use the workspace lock (Vite 8.1.5), keep Capacitor packages under
this subtree's `node_modules`, and complete Capacitor sync without native path
drift. The root coverage run passes 1,926 tests with 13 intentional skips.
