---
name: running-the-fallow-gate
description: Use before a commit, a push or a pull request handoff in the Nextly monorepo, when the fallow audit verdict is fail or its output looks empty, when reading the Code Hygiene CI report, or before deleting an export, file or dependency that fallow calls unused.
---

# The fallow gate

AGENTS.md keeps the command and its verdict rule; this is the detail behind
them, moved here whole so it is read when the gate runs rather than held in
every session. `fallow hooks install --target agent` writes the long form of
this text back between the markers in AGENTS.md; move it here again if it
does, which `pnpm check:instruction-size` will ask for.

## Fallow local gate

Before any `git commit` or `git push`, run `fallow audit --format json --quiet --explain --gate-marker agent`. If the verdict is `fail`, fix the reported findings before retrying. Treat JSON runtime errors like `{ "error": true, ... }` as non-blocking.

Audit defaults to `gate=new-only`: only findings introduced by the current changeset affect the verdict. Inherited findings on touched files are reported under `attribution` and annotated with `introduced: false`, but do not block the commit. Set `"audit": { "gate": "all" }` in `.fallowrc.jsonc` to gate every finding in changed files.

This gate reads the DIFF, and `.github/workflows/code-hygiene.yml` runs in two jobs. Its `Changed files` job runs `audit --gate new-only` via the official `fallow-rs/fallow` action, gating on newly introduced dead code and duplication in changed files, adding inline annotations and PR review threads on offending lines (with `apps/playground` excluded). Its `Whole repository` job scans the entire repository at the PR branch HEAD to post a sticky PR comment and step summary covering dead code, duplication, and code health.

What CI ENFORCES and where it enforces it: `Changed files` gates on introduced DEAD CODE and introduced DUPLICATION in the PR's changed files (failing the PR check and posting PR review threads). The whole-repo job provides comprehensive visibility into repository-wide dead code, duplication, and complexity via a sticky PR comment, failing only on tooling crashes.

A degraded run is the failure mode worth knowing about, because it reports nothing and looks identical to a clean one. The gate job reads the action's `changed-files-unavailable`, `post-skipped-reason` and `dedup-lookup-failed` outputs and refuses on an unscoped analysis or an empty verdict, naming itself a tooling failure rather than a finding in the change.

`.claude/hooks/fallow-gate.sh` is VENDORED rather than left as `fallow hooks
install` writes it. The generated script parses JSON with `jq` and compares
versions with `sort -V`, and neither is safe to assume here: `jq` is not a
dependency of this repository, and BSD `sort` has no `-V`, so on macOS the
version check aborts the hook under `set -euo pipefail`. Both are done with
node in the vendored copy, which every contributor already has — the engines
field requires it and nothing in this repository runs without it. So the gate
needs no tool a contributor does not already have installed.

That has a maintenance cost worth knowing: re-running `fallow hooks install
--target agent` OVERWRITES the file and silently puts both back. Re-apply the
vendored version if that happens. The workflows under `.github/` still use
`jq` freely — GitHub's runners ship it, and that is not a contributor's
machine.

`FALLOW_AUDIT_BASE` is pinned to `origin/main` in `.claude/settings.json`. Left unset, the audit takes its base from the merge-base with the branch's UPSTREAM, which is the remote tracking branch — stale on any branch whose local commits are not pushed, and after a rebase that means the diff carries every commit `main` gained since. Measured here: 319 changed files and a `fail` verdict on a branch whose actual diff was nine commits. Every pull request in this repo targets `main`, so naming it removes the guesswork.

For non-skill agents, treat the task map below as the local onboarding source: run the listed fallow command before destructive edits, before commits, and before pull request handoff.

## Fallow task map

| When the agent is about to...                                     | Run                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| delete an "unused" export or file                                 | `fallow dead-code --trace <file>:<export>`                                           |
| prove a TypeScript symbol's exact consumers before refactoring    | `fallow dead-code --type-aware --symbol-impact <file>:<export-or-class.method>`      |
| delete an "unused" dependency                                     | `fallow dead-code --trace-dependency <name>`                                         |
| commit or open a PR                                               | `pnpm fallow:audit` (`fallow audit --base origin/main`)                              |
| prioritize refactoring                                            | `fallow health --hotspots --targets`                                                 |
| ask who owns code                                                 | `fallow health --ownership`                                                          |
| check untested-but-reachable code                                 | `fallow health --coverage-gaps`                                                      |
| consolidate duplication                                           | `fallow dupes --trace dup:<fingerprint>`                                             |
| find feature flags                                                | `fallow flags`                                                                       |
| check which architecture rules apply to a file before changing it | `fallow guard <files>`                                                               |
| surface security candidates                                       | `fallow security`                                                                    |
| understand a finding                                              | `fallow explain <issue-type>`                                                        |
| scope a monorepo                                                  | `--workspace <glob> / --changed-workspaces <ref>` (global flags, prefix any command) |
