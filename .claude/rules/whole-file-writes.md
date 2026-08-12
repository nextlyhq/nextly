---
# Unconditional, because the subject is an ACT rather than a kind of file. Two
# things follow. Any path can be clobbered, so no glob over filenames selects
# the population; and the failure is a shell redirect, which reads nothing, so a
# rule keyed to reading a matching path would be absent at exactly the moment it
# applies. `derived-checks.md` matches by extension across the repo for the same
# reason its own header gives: enumerating directories is how it kept missing the
# code it is about.
paths:
  - "**/*"
---

## A whole-file write is a delete plus a create

`cat > f`, `>` and a full-file editor write all replace the file. When the file
already existed, its previous contents are gone, and nothing in the command
distinguishes "there was nothing here" from "I removed everything that was".

The belief that a file is new is the whole risk. Nobody overwrites a file they
know exists; they overwrite one they are sure does not. So the precaution is not
"be careful with destructive commands" — it is to establish that the path is
absent, and to treat anything short of that as a refusal to write blind.

**A failed read is not an absent file, and this is where the precaution leaks.**
"I tried to read it and got nothing back" covers a path that does not exist AND
a path that exists but could not be read — too large, binary, wrong permissions,
a tool that declines it. Both produce the same silence, and only one of them
makes a redirect safe. So the condition to require is an explicit NOT FOUND;
every other read failure aborts, because a file the reader could not open is
still a file the shell will happily truncate.

Under an editing tool that requires a prior read, use it; reaching for the shell
to write a file the tool would have made you read is how the requirement gets
bypassed, and it is the bypass rather than the command that does the damage.

**A symlink anywhere in the path defeats every check below.** A shell redirect
follows links and truncates the RESOLVED target; the named path is untouched, so
`git diff -- <path>` reports nothing and each tell and proof clears a write that
destroyed a different file.

Testing the leaf is not enough, and this is the trap: with `linkdir -> real`,
`test -L linkdir/file.txt` is FALSE — the file itself is regular — while the
write still lands in `real/file.txt`. Any component can be the link. So resolve
the whole path unconditionally with `readlink -f` and treat the RESULT as the
path being written, rather than inspecting components for links. Then every
check in this rule runs against the file that actually changed.

`turbo.json` in `packages/ui` was replaced this way. It lost
`dependsOn: ["$TURBO_EXTENDS$", "build"]` on both `test` and `test:coverage`,
plus three call-site input trees, and the result parsed, ran, and passed
everything.

## First, name the BASELINE — everything below compares against it

Every check in this rule asks one question: what was at this path before the
write. So the baseline is chosen once, and each command follows from it. Getting
this wrong is not a smaller version of the same answer — it silently swaps which
content is being judged.

Ask them in this order, because the first question that answers YES settles it:

1. **Did the path carry deliberate UNSTAGED edits that were never committed or
   stashed?** Then **git holds no copy of the pre-write state, and the procedure
   stops here.** This takes precedence even when staged edits ALSO existed — the
   index preserves only the staged subset, so restoring from it produces a
   convincing delta that silently drops the unstaged lines. Say so and go
   outside git: the editor's local history, a backup, an open buffer. A recovery
   that cannot recover is worth naming as one; running the steps anyway converts
   a known loss into an unnoticed one.
2. **Were there deliberate STAGED edits (and no unstaged ones)?** The index holds
   the pre-write state, `HEAD` never did, and comparisons are the bare
   `git diff -- <path>`, which is working tree against index. Inspect the staged
   copy with `git diff --cached HEAD -- <path>` or `git show :<path>`; note that
   `git status` shows only `MM` and reveals none of it.
3. **Otherwise** the last commit held it: the baseline is `HEAD`, and comparisons
   take the form `git diff HEAD -- <path>`.

Both failure directions are live, which is why this is not a detail. Comparing
against `HEAD` when the index is the baseline reports the staged additions as
though they were your edit — and, worse, a clobber that preserved everything in
`HEAD` while destroying the staged lines shows additions ONLY, clearing the
overwrite that just happened. Comparing against the index when `HEAD` is the
baseline misses anything already staged.

## Three tells that this has happened, in the order they appear

They are worth knowing individually, because each looks like good news:

1. **The diffstat shows deletions on a file you believe you are creating**, read
   against the baseline named above. A created file has no deleted lines, so one
   `-` in its `++---` bar settles it — but only when the comparison starts from
   before the file existed. A bare `git diff --stat` against the wrong baseline
   answers a different question: with `HEAD` as the baseline it reports
   deletions for a genuinely new path that was staged and then shortened, firing
   on a file that really is new. This is the cheapest tell and the one most
   easily read past, because by then the write has already succeeded and
   attention has moved on.

2. **A metric improves far more than the change should explain.** "1264 inputs
   became 119" was recorded as evidence that the new scoping was tight. It was
   evidence that inputs had been REMOVED. A number that moves an order of
   magnitude in the direction you were hoping for is the moment to ask which
   change produced it, not to write it down as a result.

3. **Content you did not write, and did not mean to remove, is gone.**
   Conclusive, and it has to be stated as the disappearance rather than as the
   suspicion that led there.

   Two of these three settle it and one does not, so the split is worth stating
   plainly rather than by rank: a deletion against the correctly chosen baseline
   (1) and vanished content (3) are each conclusive on their own; the metric (2)
   is only ever a prompt to go and look, because a number can move for reasons
   that have nothing to do with a write.

   What led there in the real case was noticing that the replaced file already
   used `$TURBO_EXTENDS$` — the mechanism the new comment introduced as if it
   were absent. That is a good prompt to go and look, and it is NOT evidence:
   adding `$TURBO_EXTENDS$` to `test:coverage` when `test` already uses it means
   the file was also "already doing the thing", with nothing overwritten at all.
   A tell that fires there sends a correct additive edit into a destructive
   recovery procedure, which is worse than the miss it was guarding.

   So confirm it against the baseline named above — the `--stat`, then the hunks
   — and require content that predates your edit to have vanished.

## Configuration coverage is UNEVEN, so find out before trusting green

The clobber survived `lint`, `check-types` and the full unit suite. The reason
is narrower than "configuration is untested", and the narrow version is the
useful one, because the broad version is false: nine suites in this repo read
build configuration and assert on it. `packages/blocks-engine/src/typecheck-config.test.ts`
parses `tsconfig.json`, `tsconfig.tests.json` and `package.json` and pins exact
settings; `packages/builder/src/layering.test.ts` parses `vitest.config.ts` and
asserts its `include`. For a property one of those covers, a green run IS
corroboration.

`turbo.json` has no such suite, which is why this one went through. So the
question to answer before reading green as evidence is not "is this a config
file" but "does anything read the property I just changed" — and the answer
varies by file, by package, and by which field inside it.

The consequence of getting that wrong is delayed and looks unrelated to the
diff. A dropped `inputs` entry means the hash no longer moves when that input
changes, so turbo replays a cached pass over code nothing ran against. A dropped
`dependsOn` edge means two tasks that were ordered may now be scheduled
together. Neither fails at the moment of the edit, and by the time either
surfaces the diff that caused it mentions none of the symptoms.

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

Recovery is where this rule stops being a procedure, deliberately. The full
matter of which git revision holds a given pre-write state is a large surface —
seven successive corrections to this section all found real defects in it — and
a manual that is right about six cases and silent about the seventh reads as
complete. Three things are worth stating; the rest is the situation in front of
you.

**1. Identify which revision actually holds the pre-write content, before
running anything.** No command is right by default. Ask in this order, first YES
settles it:

- Deliberate edits that were never committed or stashed, staged or not? Then
  **git does not hold it, and this is where the procedure stops.** Say so and
  look outside git — editor local history, a backup, an open buffer. Running the
  steps anyway converts a known loss into an unnoticed one.
- Otherwise it is a commit or the index, and the reading commands follow from
  the baseline section above.

**2. The restore does not carry your edit.** Re-apply it on top as the delta it
actually was — an append only where the edit was additive; for a removal or a
replacement, appending duplicates a setting or reinstates content meant to go.

**3. Prove it BEFORE submitting, against the same baseline.** Expect only the
edit you meant. This step is not optional, because the clobber and the restore
both live inside one PR: the branch diffstat nets out and reads as though
nothing happened, and that summary is exactly what hides the loss. The
merge-commit check in `verifying-merged-work.md` is a separate, post-merge
confirmation — by the time it can run, a broken config has already merged.

Two commands are worth knowing because their names mislead: `git checkout --
<path>` restores from the INDEX rather than a commit, and
`git checkout origin/main -- <path>` answers "what does main have", which is a
different question from "what was here before my write" and quietly imports
upstream changes when `main` has moved.
