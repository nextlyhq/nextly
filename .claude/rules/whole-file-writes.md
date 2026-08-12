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

`turbo.json` in `packages/ui` was replaced this way. It lost
`dependsOn: ["$TURBO_EXTENDS$", "build"]` on both `test` and `test:coverage`,
plus three call-site input trees, and the result parsed, ran, and passed
everything.

## First, name the BASELINE — everything below compares against it

Every check in this rule asks one question: what was at this path before the
write. So the baseline is chosen once, and each command follows from it. Getting
this wrong is not a smaller version of the same answer — it silently swaps which
content is being judged.

- The last commit held the pre-write state → the baseline is `HEAD`, and
  comparisons take the form `git diff HEAD -- <path>`.
- The path carried deliberate STAGED edits when it was written → the index holds
  the pre-write state, `HEAD` never did, and comparisons are the bare
  `git diff -- <path>`, which is working tree against index. Inspect the staged
  copy with `git diff --cached HEAD -- <path>` or `git show :<path>`; note that
  `git status` shows only `MM` and reveals none of it.

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

3. **Content you did not write, and did not mean to remove, is gone.** This is
   the only one of the three that is conclusive on its own, and it has to be
   stated as the disappearance rather than as the suspicion that led there.

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

The target is the **pre-write** content of that path. Which revision holds it is
a question about this working tree, so answer it before running anything — no
command is right by default:

- **`git checkout -- <path>` restores from the INDEX, not from a commit.** If
  the clobbered content was staged it repairs nothing, and if deliberate earlier
  edits were staged it reinstates those.
- **`git checkout HEAD -- <path>` is right when the last commit IS the pre-write
  state**, which is common and not a given. Where the path carried deliberate
  staged or unstaged edits when it was clobbered, `HEAD` never held them, and
  this overwrites the index and the working-tree copy alike from that commit —
  destroying the edits being recovered. Inspect the INDEX before choosing, and
  note which command actually shows it: `git status` reports only `MM`, and
  `git diff HEAD -- <path>` renders the post-clobber working tree, so neither
  displays the staged content at risk. `git diff --cached HEAD -- <path>` — or
  `git show :<path>` for the copy verbatim — is what puts it on screen. With
  uncommitted work in flight, that index copy or a stash may be the only
  surviving pre-write state, and it is the one a `checkout` from a commit
  destroys without ever having shown it to you.
- **`git checkout origin/main -- <path>` restores from `origin/main`, which is a
  different question**, and two independent things break it: the branch may have
  committed its own edits to that path, and `main` may have changed the path
  since the branch point. In the second case the checkout imports newer upstream
  content while looking like a clean repair, and no check on the branch's own
  history detects it. Reach for it only when you specifically want `main`'s
  version — not as the way to undo a clobber.
- Whichever source you take, the restore does not carry the deliberate edit —
  re-apply that on top as the delta it actually was. An append is right for the
  additive case only; for a removal or a replacement it duplicates a setting, or
  reinstates content that was meant to go.

Then prove it, and prove it **before submitting**:

- Compare the repaired path against the baseline — the same one the tells used
  and the one you restored from — and expect to see only the edit you meant. The
  command follows from that choice, as above; reaching for `HEAD` when the index
  is the baseline mixes the deliberate staged edits into the delta, so the proof
  reports a difference the recovery did not cause.
- The reason this step is not optional: the clobber and the restore both live
  inside one PR, so the branch diffstat nets out and reads as though nothing
  happened. The summary is exactly the artifact that hides this.
- The merge-commit content check in `verifying-merged-work.md` is a SEPARATE,
  post-merge confirmation. It cannot run while the PR is open, so it is not a
  substitute for the check above — by the time it is available, a broken config
  has already merged.
