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
  after publishes; a publish alone does not move it. Only move it once a
  release is verified complete: promoting a partial train points a bare
  `npm install` at a version whose siblings never shipped.
- If the Version PR looks wrong, fix the inputs (changeset files on main);
  never edit the Version PR's generated diff by hand.

## A publish is not atomic

`changeset publish` pushes packages one at a time. When one fails, the rest
are already live and cannot be unpublished, so a release can end up split
across versions. Two guards exist:

- `pnpm release:preflight` runs first inside `release:publish`. It refuses to
  start when a package has incomplete publish metadata, when the versions are
  not in lockstep, or when a package name has never been published (see
  bootstrapping below). It costs one registry lookup per package and saves a
  ten-minute build that could only end in a half-release.
- `pnpm release:verify` runs after publishing and compares the registry to the
  workspace. The consolidated tag and GitHub Release are created only when it
  passes, so git and npm cannot disagree about what shipped.

Run either by hand at any time; both are read-only.

## Recovering a partial release

Publishing is resumable: `changeset publish` skips versions the registry
already has, so a re-run only attempts the missing packages.

1. `pnpm release:verify` to list exactly which packages are missing and why.
2. Fix the cause per package (metadata, npm access, trusted publisher).
3. Re-run the release workflow. The already-published packages are skipped.
4. Do not bump the version to "get a clean run": that abandons the partial
   version permanently, leaving a hole where some packages exist at a version
   and their siblings never do.

## Bootstrapping a brand-new package

A trusted publisher is configured per package on npmjs.com, and it can only be
attached to a package that exists. A new package therefore cannot publish
through the normal OIDC flow on its first release, which surfaces as a `404
… could not be found or you do not have permission to access it`.

For each new package name, in order:

1. Confirm the manifest carries `license`, `repository.directory`,
   `engines.node`, and `publishConfig.access: "public"`. A scoped package
   without `access: "public"` is published as restricted and fails.
2. Make the first publish deliberately, then add the package's Trusted
   Publisher entry on npmjs.com (repository `nextlyhq/nextly`, workflow
   `release.yml`, environment `Production` — the environment name must match
   the workflow's `environment:` exactly).
3. Re-run the release so the package rejoins the train.

`NEXTLY_RELEASE_ALLOW_BOOTSTRAP=1` relaxes the preflight check for that first
publish only. Adding a package to the `fixed[]` group without doing this is
what makes the _next_ release fail.
