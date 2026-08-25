## An instrument that never examined its subject answers cleanly

The other rules here are about reading an answer wrongly. This one is about an
answer that was never about your subject at all — a check that ran on nothing,
a search pointed at the wrong set, a probe that failed before reaching the
mechanism, a label that means something adjacent to what you asked.

Every instance produces a confident, well-formed, ordinary-looking result. None
produces an error. That is what separates this from the failures the other files
describe: there is nothing to read more carefully.

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
  `git diff $(git merge-base $HEAD origin/main)..$HEAD`. Under a merge commit
  the merge-base IS the head, so the range was empty and the check reported
  `files touched: 0 · 0 differing` — a clean verification from a loop that
  examined nothing. Caught because the count was absurd, not because anything
  asserted.
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
  `old` occurred twice. It matched neither, wrote the file unchanged, and the
  suite passed — reported as the break not being covered. An assertion on the
  substitution count is what exposed it.
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

**Establish the control BEFORE the treatment, and require it to move.** Every
instance that was caught was caught this way, and every instance that survived
lacked it. The control is not the same as a second test: it is the same
instrument, on an input whose answer you already know, run in the same
conditions. If the control and the treatment produce the same result, the
instrument is not discriminating and neither result is evidence.

**A break that moves something is not yet a regression test.** The control tells
you the instrument discriminates; it does not tell you WHAT it discriminates on.
A test dying to some mutation proves only that it reaches some code — a
replacement mutation that happens to hit a branch the fixture never selects
kills the test for a reason unrelated to its name. Only a mutation of the branch
the test's NAME claims makes the green mean what the name says. Measured twice
in one day from opposite ends: a test that could not fail for its intended
reason, and its replacement, which also could not.

**Prefer a question the system can answer STRUCTURALLY over a string it
printed.** The positive form of the proxy failure below, measured today: asked
whether a pull request landed as a squash or a merge commit, `git merge-base
--is-ancestor <branch-head> origin/main` is decisive, because it asks the commit
graph something the graph itself determines. Reading a printed label answers a
different question — the one whose output that string was generated for — and
the two agree until they do not.

**Assert the substitution, the file list, the row count — the thing the
instrument consumed, not the verdict it emitted.** A verdict cannot tell you
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

`derived-checks.md` covers a check that computes the right thing over the wrong
domain, and an assertion satisfied by absence. `reading-a-ci-verdict.md` covers
a verdict that is green because nothing ran. This file is the generalisation
both are instances of, written after the shape appeared ten times in one day in
places none of those files reach — a shell redirect, a test fixture, a string
replacement, a worktree's build state, and a printed label.

When you find the next one, add it. The list is the argument.
