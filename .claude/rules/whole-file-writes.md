<!--
Deliberately has NO `paths` frontmatter. Claude Code loads a rule without that
field at launch, unconditionally; a rule WITH it — including `paths: ["**/*"]` —
is conditional and triggers when a matching file is read. The failure this rule
is about is a shell redirect, which reads nothing, so the conditional form is
absent at exactly the moment it applies. A path-scoped rule is also not
re-injected after /compact until it next matches, which the unconditional form
avoids.
-->

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

**Better still, do not separate the check from the write.** A probe followed by
a redirect is two operations, and anything that creates the path in between —
generated output, a concurrent tool, another session — is truncated by a check
that passed a moment earlier. An exclusive create refuses at write time instead,
which is a boundary rather than a look:

```sh
set -o noclobber; printf '%s' "$content" > path    # ONE command, both parts
```

**The option and the redirect must run in the same shell**, which for an agent
means the same tool call. Each invocation starts a fresh shell with the option
back at its default, so setting it in one call and redirecting in the next
protects nothing — measured: separate invocations truncate the file, the
compound command above fails with `cannot overwrite existing file`. `>|` opts
out where overwriting is the intent.

Node's equivalent has no such scoping problem, because the flag is an argument
to the write itself: `writeFileSync(path, data, { flag: "wx" })` throws `EEXIST`
rather than truncating. Prefer it when the choice is available.

Use one of these when the intent is genuinely "create", and keep the NOT FOUND
probe for deciding whether that is the intent at all.

Under an editing tool that requires a prior read, use it; reaching for the shell
to write a file the tool would have made you read is how the requirement gets
bypassed, and it is the bypass rather than the command that does the damage.

**A symlink anywhere in the path defeats every check below.** A shell redirect
follows links and truncates the RESOLVED target; the named path is untouched, so
`git diff -- <path>` reports nothing and each tell and proof clears a write that
destroyed a different file. Any component can be the link, and testing the leaf
does not find it: with `linkdir -> real`, `test -L linkdir/file.txt` is FALSE
because the file itself is regular, while the write still lands in
`real/file.txt`.

**The exclusive create above already answers this, which is why no path
canonicalisation is prescribed here.** Measured: with `link.txt -> real.txt`
holding content, both `set -o noclobber` and Node's `wx` flag refuse the write
and leave `real.txt` untouched; with a DANGLING `link.txt -> ghost.txt`, both
refuse as well and no `ghost.txt` is created. The refusal follows the link
without needing to be told about it, which a resolver written here cannot claim
— a leaf that exists, a leaf that is a link, a leaf that is a dangling link and
a leaf that is absent are four behaviours, and a routine short by one hands back
the wrong path silently.

That conservatism has one cost worth stating: a deliberate write through a
dangling symlink is refused too, because the link entry exists. Take that with
`>|`, or by writing the target directly, having decided it.

Resolution still matters for DIAGNOSIS — after a write, the file that changed is
the resolved target rather than the path you named, so that is what the tells
and the proof must inspect. Determine it with the platform's own tooling
(`realpath`, `fs.realpathSync`, `lstat` for the link entry itself) at the moment
you need it, rather than from a recipe transcribed here.

`turbo.json` in `packages/ui` was replaced this way. It lost
`dependsOn: ["$TURBO_EXTENDS$", "build"]` on both `test` and `test:coverage`,
plus three call-site input trees, and the result parsed, ran, and passed
everything.

## First, name the BASELINE — everything below compares against it

Every check in this rule asks one question: what was at this path before the
write. So the baseline is chosen once, and each command follows from it. Getting
this wrong is not a smaller version of the same answer — it silently swaps which
content is being judged.

The question is not "which of these two is it". Any of the last commit, the
index, a retained stash, or nothing in git at all can hold that content — an
untracked or ignored file was never in either, a stash holds edits that were
reapplied and then clobbered, and edits that were only ever in the working tree
are in none of them. Enumerating the cases cannot be complete, because which
revision holds the content depends on how the work reached the tree; what
settles it is naming the revision and CHECKING it holds what you expect:

- `git show <rev>:<path>` prints a candidate's copy — `HEAD`, a stash, any
  commit — and `git show :<path>` prints the index copy. Read the one you intend
  to restore from BEFORE restoring, and confirm it contains the pre-write
  content rather than assuming it does.
- **A command that prints nothing has not shown you the file is absent.** It is
  equally the shape of asking the wrong question, and two ways of doing that are
  easy to hit here. `<rev>:<path>` names a path inside the revision's TREE, so
  the absolute path a symlink resolver just produced is not a valid argument and
  every candidate reads as missing; convert to repository-relative first. And a
  path that was untracked when it was stashed is not in the stash commit at all
  — `git stash -u` puts it in the stash's THIRD parent, reachable as
  `stash@{n}^3:<path>` — so the obvious query says absent while git holds an
  exact copy.
- The reading commands follow from that choice. Against a commit,
  `git diff <rev> -- <path>`; against the index, the bare `git diff -- <path>`,
  which is working tree versus index. Note that `git status` shows only `MM` and
  reveals neither.
- **Those forms only compare TRACKED content.** If the recovered path is
  untracked — the `stash@{n}^3` case above is the common one — `git diff <rev>`
  reports the baseline as deleted and says nothing about what the file now
  holds, whatever that is. Measured: with the original in the stash and
  replacement text on disk, it prints `-ORIGINAL` and no `+` line at all, so a
  clobber reads as a plain deletion. Materialise the candidate
  (`git show <rev>:<path> > /tmp/base`) and compare with
  `git diff --no-index /tmp/base <path>`, which reads both sides from the
  filesystem and shows `-ORIGINAL +CLOBBERED`.

**If no revision holds it — and you have established that rather than inferred
it from an empty result — stop.** Say so and look outside git — editor local
history, a backup, an open buffer. A recovery that cannot recover is worth
naming as one; running the steps anyway converts a known loss into an unnoticed
one, because the resulting diff looks entirely clean.

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
   before the file existed.

   Read against the wrong baseline it answers a different question, and a new
   path that was STAGED is the case that makes this concrete. The index holds
   its pre-write content and `HEAD` does not, so the index IS the baseline —
   the bare `git diff --stat` is the right command, and it correctly shows
   deletions when that staged content was clobbered. Reaching for `HEAD` there
   compares against a revision where the path does not exist at all, which
   reports additions only and clears the overwrite. The baseline section decides
   this; the tell just uses what it decided. This is the cheapest tell and the
   one most easily read past, because by then the write has already succeeded
   and attention has moved on.

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

Recovery is deliberately not a procedure here. Which revision holds a given
pre-write state depends on how the work reached the tree — committed, staged,
stashed, or never recorded — and a manual that covers most of those and is
silent about the rest reads as complete, which is worse than being brief. Three
things are worth stating; the rest is the situation in front of you.

**1. Identify which revision actually holds the pre-write content, and read it,
before running anything.** That is the baseline question above, including its
stop condition. No command is right by default.

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
