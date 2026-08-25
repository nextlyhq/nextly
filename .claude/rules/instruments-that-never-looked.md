## An instrument that never examined its subject answers cleanly

The other rules here are about reading an answer wrongly. This one is about an
answer that was never about your subject at all — a check that ran on nothing,
a search pointed at the wrong set, a probe that failed before reaching the
mechanism, a label that means something adjacent to what you asked.

Every instance produces a confident, well-formed, ordinary-looking result, and
none of them produces any indication that the subject went unexamined. Some
produce no error at all; one below produces a RED — an export-removal probe
whose worktree was unbuilt, so a setup guard threw before a single test ran.
That is worse rather than better, because a failure is read as a verdict about
the change. Either way there is nothing in the output to read more carefully.

**Twelve instances were measured in a single day, across three lanes working
independently.** They are listed below with what each one actually did, because
the shape is only convincing at that density — any one of them reads as an
ordinary mistake.

### The measured instances

**The output never reached the reader.**

- A review round's findings were read through `head -150`. It cut the eighth
  finding off; seven were worked and six were reported. The missing one was a
  P1. Committed while working a review about instruments that answer without
  looking.
- A build inside a break-verification was run as `pnpm ... build > /dev/null 2>&1`
  with the status unread. The break it was preparing never applied, and the
  suite that followed went green having tested the unmodified code.

**The input set was empty, or was not the set being claimed.**

- A landed-whole check derived its file list from
  `git diff $(git merge-base $HEAD origin/main)..$HEAD`, run after the branch
  merged. The precondition is not "a merge commit exists" — it is that
  `origin/main` already CONTAINS `$HEAD`, which a two-parent merge of the branch
  achieves and a squash never does. The merge-base is then `$HEAD` itself, the
  range is empty, and the check reported `files touched: 0 · 0 differing` — a
  clean verification from a loop that examined nothing. Caught because the count
  was absurd, not because anything asserted.
- A sweep for one defect enumerated every site that PASSED an option and
  reported the property complete. The defect lived in the sites that consumed
  the CONSEQUENCE of that option being set — a different population, which no
  amount of care within the first could reach. Two more instances of the same
  defect arrived in the next review round.
- `ledger pending` returned nothing and was read as "this never reached the
  founder". It means "nothing is waiting"; the decision had already been made.
  Absence of a pending item and absence of a decision are different sets.
- A task was recommended to the founder as "the quietest row, one commit in two
  weeks", from a history query run against two paths that DO NOT EXIST. The real
  paths had fifteen commits in three weeks. An empty history reads as "quiet";
  it never reads as "you asked about somewhere else".

**The subject never reached the instrument.**

- A break-verification patched a file with `str.replace(old, new, 1)` where
  `old` occurred TWICE. It duly replaced the first — which was not the site
  under test — so the file changed, the build succeeded, and the suite passed.
  Reported as the break not being covered. The count assertion added on the
  retry is what exposed it, by refusing rather than by patching: `assert
s.count(old) == 1` failed, and the failure named the ambiguity. Note the
  shape — the mutation DID reach the code, just not the code whose behaviour
  was being claimed.
- A probe removing two exports to prove a manifest test would catch them
  reported a red. The worktree had no built declarations, so a global-setup
  guard threw before any test ran. The restored control failed identically,
  which is the only reason it was caught: **a red that occurs with and without
  the change under test is evidence of nothing.**

**The assertion was satisfied by a state that predated the change.**

- A test asserting a refused stylesheet came back as `css === ""`. The fixture's
  node carried no styles, so the sheet was empty before the refusal could act.
  The control — the same call on an artifact that must NOT be refused — is what
  exposed it.
- A test named "does not scan the whole string to reach a refusal" asserted the
  return value. Check-then-trim and trim-then-check both return `undefined` for
  an over-cap string, so the assertion could not separate them and the property
  the test was named for had no coverage at all.

**The claim was never checked against the act.**

- A lane reported to the founder that it had released a tracker claim, then
  checked and found the claim still held. Nothing failed; the release simply had
  not happened, and the report was written from the intention rather than from
  the state. Saying and doing are different facts, and only one of them is
  observable — so the report is not evidence about the system, it is evidence
  about the reporter's belief.

**A proxy was read as the property.**

- `scripts/verify-merge.mjs` printing `(merge commit; branch <sha>)` was cited
  as proof that it detects the merge strategy. The label is gated on GitHub's
  `merged` flag and prints identically for a squash. It marks a phase — the
  subject is now the merge SHA rather than the branch tip — and says nothing
  about parent count.

### What actually catches these

**Read how the answer is PRODUCED before citing it.** Not read the answer more
carefully — that is what failed in every case above. The label, the count, the
exit status and the green all looked correct; what was wrong was the path that
generated them. Where the instrument is a command, that means reading its
source or its gating condition. Where it is a query, it means naming the set it
selected from.

**Establish the control BEFORE the treatment, and require it to move.** This is
the most broadly useful of the checks here and it is not how every instance
above was caught — two were found by the population checks below instead, the
empty merge-base range by a count that was absurd and the misplaced replacement
by an assertion on the substitution. Those are different instruments and the
file needs all of them; a reader who takes the control as the sole safeguard
will keep the two that it does not reach. The control is not the same as a second test: it is the same
instrument, on an input whose answer you already know, run in the same
conditions. If the control and the treatment produce the same result, the
instrument is not discriminating and neither result is evidence.

**A control has to be CAPABLE of the outcome you are ruling out**, and this is
where a control that looks correct fails silently. Measured today, verifying a
merge by comparing files between two revisions: the discrimination control was
`README.md`, which is byte-identical on both sides. It passed — and it could
only ever have passed, so it certified the comparison by never asking it
anything. Fourteen-of-fourteen identical meant nothing until a file the other
branch HAD touched came back different.

The axis follows from the claim being made, and both reduce to the same test:

- an ABSENCE claim ("this marker is gone", "no violation was found") needs a
  control that must be FOUND. Otherwise a search that can find nothing at all
  satisfies it.
- a SAMENESS claim ("these are identical", "nothing changed") needs a control
  that must come out DIFFERENT. Otherwise a comparison that reports everything
  as equal satisfies it.

Concretely, for the merge case:

```sh
git rev-parse <merge>:README.md <head>:README.md    # one sha twice — proves nothing
git rev-parse <merge>:<a-file-the-other-branch-touched> <head>:<same>   # must DIFFER
```

Worth stating because the second kind is the one nobody builds: a lane that had
been constructing must-be-found controls for years had never once built a
must-differ control, and neither had the author of this file.

**A break that moves something is not yet a regression test.** The control tells
you the instrument discriminates; it does not tell you WHAT it discriminates on.
A test dying to some mutation proves only that it reaches some code. Both
directions of that are live and they need separating:

- a mutation the fixture never REACHES leaves the test green, so the property
  reads as covered while nothing exercises it;
- a mutation the fixture does reach, but which breaks something other than the
  named property — a shared helper, a constructor, an import — kills the test
  for a reason that has nothing to do with what its name claims.

Only a mutation of the behaviour the test's NAME claims makes the green mean
what the name says. Measured twice in one day from opposite ends: a test that
could not fail for its intended reason, and its replacement, which also could
not.

**Prefer a question the system can answer STRUCTURALLY over a string it
printed.** The positive form of the proxy failure below. Asked how a pull
request landed, read the MERGE COMMIT's parents rather than any printed label:

```sh
gh pr view N --json mergeCommit --jq .mergeCommit.oid   # then fetch it
git log --format='%H %P' -1 <mergeCommit>               # two parents = a merge
```

`git merge-base --is-ancestor <head> origin/main` is the tempting one-liner and
it answers a DIFFERENT question — whether one commit is reachable from another,
which says nothing about strategy on its own. It also depends on a ref that
moves: unfetched, a genuine merge reports non-ancestor; later, unrelated
commits can make ancestry true. `verifying-merged-work.md` already requires
fetching both objects and probing the merge commit rather than `origin/main`,
and that requirement is exactly this failure seen from the other side.

**Assert what the instrument CONSUMED, not the verdict it emitted** — the
substitutions made, the files read, the rows fetched. Assert them by MEMBERSHIP
rather than by cardinality: a count is the same substitution one level up, and a
selector that drops an expected row while adding an unrelated one matches any
total you compare against. `derived-checks.md` makes this case at length; it is
repeated here only because the instruments in this file fail at the point where
the count is the easiest thing to reach for. A verdict cannot tell you
whether it had anything to judge. This is the population rule from
`derived-checks.md`, and the instances above are what it looks like when the
population is not merely small but absent.

**Prefer an instrument that cannot have the failure to one that detects it.**
`scripts/verify-merge.mjs` is immune to the merge-base trap not because it
handles both strategies but because it never asks a merge-base question —
its stranded-tail screen is bounded by `headRefOid..<ls-remote tip>`, which is
correct under either. Immunity by construction survives a case nobody
enumerated; immunity by case analysis survives exactly the cases listed.

### Two things this rule is not

**It is not "be more careful".** Most of these were produced by people actively
applying the other rules in this directory. **Three were produced while reading
or writing this file**, and the third is the load-bearing one: a reply was
addressed to the name a correspondent SIGNED with rather than to the structural
field the transport carries — a self-reported label standing in for the real
identifier, committed inside the paragraph about self-reported labels standing
in for real identifiers.

That is not irony. It is the evidence. Care was maximal — the author was
attending to this exact failure, in this exact section, at that exact moment —
and the failure occurred anyway. Whatever prevents these, it is not attention,
because attention was the one input already at its ceiling.

**It is not a reason to distrust green.** A control that moves is real evidence,
and treating every clean result as suspect costs more than the failures do. The
question to ask is narrow and cheap: _what else would produce this exact
output?_ If the answer includes "the instrument not running", get the control
first.

### Where this sits

**Most of what is here is already covered somewhere, and this file does not
replace any of it.** `reading-a-ci-verdict.md` gives the shell redirect with an
unread status its own table. `derived-checks.md` gives fixtures that never reach
the mechanism, the positive controls that expose them, and the population rule
in full. Where those two are the authority, defer to them: the guidance above
restates only enough to make the shape visible, and where it is thinner than
they are, they are right.

What is not covered elsewhere is the SHAPE — that a check reading the wrong set,
a probe dying before it starts, a self-reported label read as a structural fact,
and a report written from intention rather than state are one failure wearing
four costumes. Each of those files describes its own instance as a property of
its own domain. Seeing them as one is what predicts the next instance, which is
in whatever domain nobody has written a file about yet.

So the value here is the density, not the individual entries. When you find the
next one, add it — and if it is a fourth example of a mechanism already listed
three times, leave it out. The list is an argument, and a catalogue is skimmed.
