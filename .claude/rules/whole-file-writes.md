---
# Scoped to everything, and the first draft's path list is why. It named
# `tsup.config.ts` and `vitest.config.ts` and therefore missed
# `packages/nextly/tsup.config.js`, `packages/ui/tsup.server-safe.config.ts`,
# `packages/*/vitest.integration.config.ts` and `apps/playground/next.config.ts`
# — an enumeration of spellings, in a rule about not enumerating.
#
# The deeper reason is that a path-scoped rule loads when a matching path is
# READ or EDITED, and the failure here is a shell redirect that reads nothing.
# The rule would have been absent at exactly the moment it applies. This is a
# property of the ACT, not of the file type.
paths:
  - "**/*"
---

## A whole-file write is a delete plus a create

`cat > f`, `>` and a full-file editor write all replace the file. When the file
already existed, its previous contents are gone, and nothing in the command
distinguishes "there was nothing here" from "I removed everything that was".

The belief that a file is new is the whole risk. Nobody overwrites a file they
know exists; they overwrite one they are sure does not. So the precaution is not
"be careful with destructive commands" — it is to READ the path first, and treat
a successful read as a refusal to write blind. Under an editing tool that
requires a prior read, use it; reaching for the shell to write a file the tool
would have made you read is how the requirement gets bypassed, and it is the
bypass rather than the command that does the damage.

`turbo.json` in `packages/ui` was replaced this way. It lost
`dependsOn: ["$TURBO_EXTENDS$", "build"]` on both `test` and `test:coverage`,
plus three call-site input trees, and the result parsed, ran, and passed
everything.

## Three tells that this has happened, in the order they appear

They are worth knowing individually, because each looks like good news:

1. **The diffstat shows deletions on a file you believe you are creating.** A
   created file has no deleted lines, so a single `-` in its `++---` bar is
   conclusive, whatever the counts. This is the cheapest tell and the one most
   easily read past, because by then the write has already succeeded and
   attention has moved on.

2. **A metric improves far more than the change should explain.** "1264 inputs
   became 119" was recorded as evidence that the new scoping was tight. It was
   evidence that inputs had been REMOVED. A number that moves an order of
   magnitude in the direction you were hoping for is the moment to ask which
   change produced it, not to write it down as a result.

3. **The overwritten content contradicts the reason you gave for writing it.**
   The replaced file already used `$TURBO_EXTENDS$` — the very mechanism the new
   comment introduced as if it were absent. Whenever a file turns out to have
   been doing the thing you are adding, you did not add it; you replaced
   something that already worked.

## Why build configuration is the worst place for it

The clobber survived `lint`, `check-types` and the full unit suite, because no
test asserts on build configuration. Product code has a suite standing behind
it; a `turbo.json`, a `tsconfig`, a `tsup.config.*`, a `vitest.*.config.*`, a
`next.config.*`, a workflow file and a `package.json` have only the diff. Green
after touching one of these is not corroboration — it is the absence of any
instrument. That list is examples rather than a boundary: the property is "no
suite reads it", not the filename.

The consequence is delayed and looks unrelated. Dropping this package's own
`build` from `dependsOn` leaves the root task's `^build`, which builds
DEPENDENCIES and not this package, so turbo becomes free to schedule `build` and
`test:coverage` together: the surface suite's `beforeAll` runs `tsup` while
`build:js` is removing `dist` underneath it, and coverage reads half-written
artifacts. That surfaces later, as flake, in a package whose diff no longer
mentions any of this.

## `$TURBO_EXTENDS$` means the package config ADDS

Two package configs use it — `packages/ui/turbo.json` and
`packages/blocks-react/turbo.json` — and both rely on the property:
`$TURBO_EXTENDS$` inside `dependsOn` or `inputs` interpolates the ROOT task's
list at that position. `["$TURBO_EXTENDS$", "build"]` is "everything the root
task depends on, plus this package's own build".

So a package task list is an APPENDIX, never a replacement, and writing one from
scratch is a silent subtraction: the file still parses, turbo still runs, and
the inherited entries are simply not there. To add an input, append to the
existing array. If you find yourself composing the whole array, you are about to
drop whatever the root supplies.

## Restoring, and proving the restore

The target is the **pre-write** content of that path, which is not a fixed
command — name it before running anything:

- **`git checkout -- <path>` restores from the INDEX, not from a commit.** If
  the clobbered content was staged it repairs nothing, and if deliberate earlier
  edits were staged it reinstates those. `git checkout HEAD -- <path>` is the
  form that goes to the last commit.
- **`git checkout origin/main -- <path>` is right only when the branch has made
  no committed change to that path.** Otherwise it discards this PR's own
  earlier edits along with the clobber, while looking like a clean repair. Check
  that condition — `git log <base>..HEAD -- <path>` — rather than reaching for
  the command because it worked somewhere else.
- Whichever source you take, the deliberate edit is then re-applied on top as an
  APPEND. The restore does not carry it.

Then prove it, and prove it **before submitting**:

- Compare the repaired path against its pre-write version —
  `git diff <pre-write-rev> -- <path>` — and expect to see only the edit you
  meant. The clobber and the restore both live inside one PR, so the branch
  diffstat nets out and reads as though nothing happened; the summary is exactly
  the artifact that hides this.
- The merge-commit content check in `verifying-merged-work.md` is a SEPARATE,
  post-merge confirmation. It cannot run while the PR is open, so it is not a
  substitute for the check above — by the time it is available, a broken config
  has already merged.
