## An instrument that never examined its subject answers cleanly

The other rules here are about reading an answer wrongly. This one is about an
answer that was never about your subject at all — a check that ran on nothing,
a search pointed at the wrong set, a probe that failed before reaching the
mechanism, a label that means something adjacent to what you asked.

Every instance produces a confident, well-formed, ordinary-looking result. None
produces an error. That is what separates this from the failures the other files
describe: there is nothing to read more carefully.

**Ten instances were measured in a single day, across three lanes working
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

**It is not "be more careful".** Nine of the ten instances were produced by
people actively applying the other rules in this directory, and two were
produced while reading or writing about this very shape. Care is not the
variable.

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
