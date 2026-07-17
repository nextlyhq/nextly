---
name: release-and-changesets
description: Use when adding a changeset to a PR, deciding whether a PR needs one, cutting or debugging a release, or when the Version PR / npm publish flow looks wrong.
---

# Changesets and releases in the Nextly monorepo

## The changeset rules (non-negotiable)

- **ONE changeset per PR**, not per commit.
- It must list **ALL published packages** (they are a `fixed` lockstep group
  in `.changeset/config.json`; the repo is in pre-release `alpha` mode via
  `.changeset/pre.json`).
- Always **`patch`** while in alpha.
- The description is the USER-facing impact, one or two lines, not an
  implementation note.
- **No changeset** for PRs that touch only tests, CI/workflows, repo docs,
  or other non-published files. When in doubt: does the change alter what a
  user installs from npm? No -> no changeset.

Create one with `pnpm changeset` (select all packages, patch) or write the
file by hand under `.changeset/` following an existing one.

## How releasing actually works (CI-only)

1. PRs with changesets merge to `main`.
2. The Changesets bot maintains a Version PR ("chore: version packages
   (alpha)") that accumulates pending changesets, bumps every package in
   lockstep, and updates changelogs.
3. **Merging the Version PR publishes**: the release workflow builds and
   publishes all packages to npm via trusted publishing (OIDC) in the
   protected environment. There are no local publishes; never run
   `changeset publish` or `npm publish` yourself.
4. Tags (`vX.Y.Z-alpha.N`) and a consolidated GitHub Release are created by
   the workflow.

## Known gotchas (learned the hard way)

- The release workflow pins an exact npm version on purpose (a floating
  `npm@latest` once broke every release via an engines bump). Do not
  "simplify" it back to latest.
- Old branches can restore already-published changeset files on merge; if
  the Version PR suddenly lists ancient entries, check for resurrected
  `.changeset/*.md` files and delete them in a cleanup PR.
- The npm `latest` dist-tag for the unscoped packages is managed manually
  after publishes; a publish alone does not move it.
- If the Version PR looks wrong, fix the inputs (changeset files on main);
  never edit the Version PR's generated diff by hand.
