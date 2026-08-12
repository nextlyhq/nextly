---
# Build configuration is where this costs the most, because no suite reads it —
# but the failure is the write, not the format, so the paths cover every config
# a whole-file write plausibly lands on.
paths:
  - "**/turbo.json"
  - "**/turbo.jsonc"
  - "**/tsconfig*.json"
  - "**/package.json"
  - "**/tsup.config.ts"
  - "**/vitest.config.ts"
  - "**/*.yml"
  - "**/*.yaml"
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
would have made you read is how the requirement gets bypassed.

`turbo.json` in `packages/ui` was replaced this way. It lost
`dependsOn: ["$TURBO_EXTENDS$", "build"]` on both `test` and `test:coverage`,
plus three call-site input trees, and the result parsed, ran, and passed
everything.

## Three tells that this has happened, in the order they appear

They are worth knowing individually, because each looks like good news:

1. **The diffstat shows deletions on a file you believe you are creating.**
   `61 ++---` on a new file is not a formatting artifact. A created file has no
   deleted lines. This is the cheapest tell and the one most easily read past,
   because by then the write has already succeeded and attention has moved on.

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

## Why configuration specifically

The clobber survived `lint`, `check-types` and the full unit suite, because no
test asserts on build configuration. Product code has a suite standing behind
it; a `turbo.json`, a `tsconfig`, a workflow file and a `package.json` have only
the diff. Green after touching one of these is not corroboration — it is the
absence of any instrument.

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

`git checkout origin/main -- <path>` puts the file back, and re-applies the
edit as an append. Two follow-ups make the difference between believing it and
knowing it:

- `git checkout -- <path>` restores to the last COMMIT, not to the state before
  your write. Commit or stash deliberate work first, or the restore takes that
  with it.
- Verify by CONTENT in the merge commit, not by "I restored it" —
  see `verifying-merged-work.md`. The clobber and the restore both live inside
  one PR, so the diffstat nets out and reads as though nothing happened.
