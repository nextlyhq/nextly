---
# Derived checks are not a packages/ phenomenon. Enumerating directories is how
# this rule kept missing the code it is about — admin-css ships product code and
# tests as .mjs, playground scripts assert agreement between a declaration and an
# import, e2e specs recompute coordinates the app already derives, and the prose
# section below applies squarely to docs and READMEs. Match by extension across
# the repo rather than by location.
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.mjs"
  - "**/*.js"
  - "**/*.cjs"
  - "**/*.md"
  - "**/*.mdx"
  # Configuration is where several of this rule's own examples live: the
  # changeset package list versus the release group, and `pnpm-workspace.yaml`
  # against the hand-maintained ALL_PACKAGES list that `scripts/lint-report.mjs`
  # says must mirror it. Editing only the config is exactly the recomputation
  # drift this rule is about.
  - "**/*.json"
  - "**/*.jsonc"
  - "**/*.yaml"
  - "**/*.yml"
  # Shell verifiers count too: `packages/nextly/scripts/phase-gate.sh` parses
  # test, lint and type-check counts and compares them against stored baselines,
  # which is a derived check in every sense except the language it is written in.
  - "**/*.sh"
  # Tracked derived artefacts with no source extension of their own: committed
  # `*.snap` files ARE the derived view, and `apps/playground/.env.example:17`
  # names `packages/nextly/src/shared/lib/env.ts` as its source of truth.
  - "**/*.snap"
  - "**/.env.example"
  - "**/*.env.example"
  # And the derived ARTEFACTS, not only the code that derives them:
  # `apps/playground/src/plugins/style-fixture/admin.source.css` compiles into a
  # derived `admin.css`, and `templates/blog/migrations/*.sql` say outright that
  # their structure mirrors `UserExtSchemaService.generateMigrationSQL()`.
  - "**/*.css"
  - "**/*.sql"
  - ".changeset/**"
---

When one piece of code checks, mirrors or summarises what another produces:

## Derive it, do not recompute it

A narrower view must be derived FROM the richer one. Two implementations of the
same question agree on the day they are written and drift afterwards, and the
drift is silent because both look correct in isolation.

This has caused defects in five unrelated packages that share no code: block
rendering versus derived metadata, a contrast validator versus its measurement,
an email form schema versus its descriptors, a changeset's package list versus
the release group, and a data probe versus the conversion it guards.

Two rules follow, and the second is the one that gets missed:

- Export the answer from one place and have both callers ask it.
- **A test is a derived view of the code like any other.** Prefer OBSERVING the
  real call — spy on the arguments a function actually receives — over
  reconstructing the same call in the test. A hand-copied argument list keeps
  passing after someone edits the line the test exists to watch.

## A derived check must match on three axes, not one

Asking "does it compute the same thing" is not enough:

1. **Computation** — the same expression.
2. **Domain** — the same rows, records or inputs. A probe using the identical
   expression over a different row set is still a divergence.

   **`LIMIT 1` is sound exactly when ONE row settles the claim.** Which rows
   those are depends on what is being claimed, not on the clause:
   - claiming _something exists_ → one match settles it. `LIMIT 1` on the match
     is sound.
   - claiming _everything satisfies P_ → one match of P settles nothing, but one
     match of NOT-P refutes it. So search for the counterexample and `LIMIT 1`
     is sound; search for a witness of P and it is not.

   The two queries look nearly identical in the source, which is why the claim
   has to be written down next to them. A universal check phrased as a witness
   hunt passes on the first agreeable row and never reads the rest.

   **In SQL, `NOT P` is not the complement of `P`.** The logic is three-valued:
   for a NULL input both `P` and `NOT P` evaluate to UNKNOWN, and `WHERE`
   keeps only TRUE. So `WHERE NOT (price > 0) LIMIT 1` returns no row for a
   table full of NULL prices and certifies "every price is positive" — the
   counterexample hunt, done correctly, silently reporting the opposite of the
   truth. Decide first whether NULL violates the claim, then write the
   predicate that says so: `WHERE (price > 0) IS NOT TRUE` catches NULLs as
   violations, `WHERE price IS NOT NULL AND NOT (price > 0)` excludes them
   deliberately. Either is fine; the bare `NOT` is the one that is neither.

3. **Failure semantics** — "the answer is no" and "I could not ask" are
   different outcomes. A check that reports a lock timeout as a data verdict
   blocks valid work while naming the wrong cause. Pin the error you mean, and
   remember the signal may be WRAPPED: a driver error's code often lives on
   `.cause`, and how deep depends on the transport, not on your code.

Underneath all three sits time-of-check-to-time-of-use, which may need a
different answer per dialect. Say which dialect a mitigation covers rather than
implying one policy fits all.

## Citing a known defect invalidates the claims that assume its absence

Two implementations drifting apart is the code version of this. The prose
version is a document that invokes a known defect for one purpose — arguing
severity, justifying a workaround — while another paragraph asserts something
that is only true if the defect does not exist. Both sit on the page together
and neither looks wrong alone, which is why re-reading does not catch it.

The check is mechanical rather than a matter of care: after citing a defect,
re-read every statement about the POPULATION it affects.

Worked example, from a schema task in this repo. A standing "core schema
changes may not reach existing databases" was cited for severity in one
paragraph. The next asserted that no existing database could hold duplicate
rows, derived from the constraint its schema declares — which is precisely the
guarantee the cited defect removes. The safety analysis was built on the
absence of the defect being argued from.

The same shape appears without any document involved, which is worth knowing
because it is the harder one to see. A control that needed to modify a test file
was run in a DISPOSABLE worktree specifically so there would be nothing to
restore. Twenty minutes later a control on a tooling script modified it in place
with a hand-rolled backup, the backup was taken after a previous run had already
contaminated the file, and "restoring" reinstated the contamination.

The instinct was not missing. It was SCOPED — available under "test code", not
transposed to "tooling" — and the boundary was a category in the author's head
rather than anything present in the work. Both halves were twenty minutes apart,
both were the same person's, and neither looked wrong at the time. When you
solve something structurally, ask what else you are doing right now that the
same structure would fix.

## When a check reaches for a NAME, ask what structurally decides it

A name, a version string or a string pattern is nearly always a proxy, and the
cases that motivated writing the check are the ones that violate the proxy.

The reason is worth stating, because it tells you when the rule applies: **a
name is a claim made by someone else; structure is the thing itself.** The
engine chose the collision suffix, the vendor chose what version to report, a
previous release of your own code chose the prefix. You never controlled any of
those strings, and the check exists precisely for the cases where the other
party's choice diverges from your expectation — so the divergence and the check
have the same cause. Not every string in a codebase has that property; the ones
assigned by something outside your control do.

Five instances in one area, each found only after the name-based version had
been written:

- classify a driver failure by SQLSTATE at the specificity YOUR claim needs, not
  by a hand-kept list of codes;
- identify a database object by its **structural signature**, not by its name —
  an engine appends `_2` on collision and truncates at its identifier limit, so
  there is no single string to match;
- decide a capability by **probing it on a scratch object**, not by reading the
  server's version — the platforms worth detecting are the ones that misreport;
- decide indexability by asking the **shared rule**, not by restating which
  types a dialect can key;
- confirm a merge by **comparing the PR's delta**, not by grepping for a marker
  that may occur elsewhere.

The tell is a check whose correctness depends on how some other system chose to
spell something. Ask instead what property makes the answer true, and query
that. It is usually available and it usually costs the same.

**"Structural" is not automatically "coarse", and the first two above are where
that bites.** Replacing a name with a broader property is only correct when the
broader property still separates the cases you must tell apart:

- SQLSTATE **class** `23` is right for "is this an integrity failure at all". It
  is wrong the moment the caller must distinguish one from another — this repo's
  `packages/nextly/src/database/errors.ts` maps `23505`, `23503` and `23502` to
  unique, foreign-key and not-null respectively, and collapsing them to the class
  would report a missing NOT NULL as a duplicate. Match at the specificity the
  claim requires: class when the claim is about the family, code when it is about
  the member.
- A **column set** is right for "is any object covering these columns present".
  It is wrong for "which object implements this guarantee", because one table can
  carry several objects over the same columns — and this repo already treats
  `{ columns: ["code"], unique: false }` and `{ columns: ["code"], unique: true }`
  as different indexes during an index-to-unique transition. Match the signature
  the CLAIM needs: columns, uniqueness, and whether a constraint owns the object.

  Note what that signature does NOT currently separate. `indexKey` in
  `schema/pipeline/diff/index-util.ts` SORTS the columns, so `(a, b)` and
  `(b, a)` compare equal — even though only the first serves a left-prefix
  lookup on `a`. Today the pipeline emits single-column indexes, so nothing
  depends on the distinction; the moment a composite one is emitted, the key
  will silently treat two different objects as one. Stated here rather than
  fixed, because widening the key changes every comparison that uses it.

So the rule is not "prefer the broadest structural property". It is: identify by
structure rather than by someone else's spelling, at the granularity your claim
actually needs — which is the separating-property test applied to the identifier
itself.

## The THIRD finding of one shape is a prompt to TEST the check

Two findings that rhyme are a coincidence. The third is worth a minute spent on
the instrument rather than the instance — but it is a PROMPT, not a verdict, and
the distinction is load-bearing. Three hardcoded-colour findings usually mean
the change contains three hardcoded colours. A rule that let the count alone
condemn the check would talk a reviewer out of reporting the fourth real
violation, which is worse than the patching it was written to stop.

So the third finding buys an experiment, not a diagnosis. Run the check against
cases where you already know the answer — and the controls must exercise the
SHAPE the findings kept arriving in, not merely some case with a known answer.
An easy positive and an unrelated valid negative both pass while the check still
misreads the alias, the runtime value or the population behind every one of
those findings, which certifies the instrument on the strength of never having
asked it the question:

- a POSITIVE control — an input carrying the repeated shape that must be
  reported, where the expected result is not "nothing". A check that reports
  nothing under every circumstance passes every negative control ever written.
- a NEGATIVE control — a valid input it must stay silent on, in that same shape:
  the aliased spelling, the computed value, the member of the population the
  findings clustered around.

One pair per SUBSHAPE, because a family of findings usually is not one shape.
A scanner that handles a named alias can still misread a namespace alias and a
default import — three subshapes that look like one "alias" problem, and
controls built on the first certify nothing about the other two. Each subshape
that produced a finding needs its own pair.

And passing them certifies the CHECK on those shapes, not the findings. The
reported instances still have to be judged one at a time: a control proves the
instrument answers correctly on an input whose answer you knew, which is a
different claim from every existing report being real. Where the two are
confused, a green control run quietly converts open findings into resolved ones.

If the controls pass, the instrument is sound on the shapes exercised — say so,
rather than leaving it under suspicion, and go on judging the reported findings
ONE AT A TIME. Passing controls does not confirm any of them; a check can be
right about the shapes you tested and wrong about the instance in front of you.

If a control fails, do not conclude "the check is broken" either. A fixture that
never invoked the check fails its control while the reader and the classifier
are both fine — the HARNESS case below — so a red control means only that the
run did not produce the expected result. Establish that the check was actually
exercised before diagnosing it, and then ask which of three things is
unreliable; the remedies differ, and applying the wrong one looks like
diligence:

- **The READ** — the check cannot see what it is looking at. Before reaching
  for a rewrite, separate two cases a failed control cannot tell apart, because
  it proves only that the reader did not see the value, never that its
  instrument could not represent it:
  - a **repairable omission** — the instrument represents the thing fine and
    the reader forgot a case. An AST visitor that misses default imports, or a
    node kind it never listed, is this. Extend it; a rewrite here throws away a
    correct approach and starts the same list of cases over.
  - an **abstraction mismatch** — the instrument cannot represent the thing at
    all, so every fix buys one spelling and the list has no end. A regex over
    source cannot represent nesting; an AST cannot represent a value that only
    exists at runtime. Replace it: a regex becomes a walk over the compiler's
    own AST, an AST prediction of a runtime value becomes the runtime value.

  **Do not settle this by asking whether the fixes have converged.** A visitor
  that has simply not yet met its next unsupported form is indistinguishable
  from a complete one, so "no failure since the last fix" certifies
  patch-by-example after any number of rounds — the same absence-is-not-evidence
  trap this file is otherwise about.

  What separates them is whether the instrument's input DETERMINES the property
  you are asking about. Not whether the syntax is finite — it usually is, and
  that is why counting node kinds does not settle it. A JSX expression admits a
  listable set of kinds, and two of those kinds are an identifier and a call,
  whose resulting class string may not exist until the program runs. Finite
  syntax, undetermined value.

  So ask of the specific question: given everything this instrument can see, is
  there exactly one answer? "Which JSX node encloses this element" — yes, the
  tree says so, and a reader that gets it wrong is missing a case. "What string
  will this expression evaluate to" — no, not from source, however many node
  kinds you handle. The first is a repairable omission however long the list;
  the second is a mismatch on the first example, and no amount of enumeration
  reaches it.

  Worked example of the second: a source
  check for a component's class names took thirteen rounds finding spellings it
  read wrongly — aliases, namespace imports, `{...{ className }}`, `+`
  concatenation, template interpolation, character references. Each fix was
  right and each was followed by another, because the surface was the whole
  language. The end was to stop predicting the string and read it where it
  already exists. Worked example of the first: a JSX visitor that missed
  fragments, and later an identifier wrapped in a conditional. Two gaps, both
  closed by asking what ENCLOSES a node rather than matching one relationship —
  and the AST was the right instrument throughout.

- **The CLASSIFICATION or the POPULATION** — the check sees correctly and
  decides wrongly, or looks at the wrong set. Identify by structure rather than
  by a proxy, or enumerate the members instead of counting them. Worked example:
  an exemption allowing "one detached pager in this file" excused whichever
  pager came first, because two pagers on one page can be identical in every
  respect the check could see. Deleting the exempt one and detaching a different
  one left the count unmoved and every assertion green. Naming the exempt pager
  fixed it; a bigger allowance never would have.

- **The EMISSION or the HARNESS** — the check reads correctly, decides
  correctly, and the verdict never reaches anyone. A changed-lines filter drops
  it, a baseline absorbs it, a formatter swallows it, a reporting step is not
  wired up — or the control fixture never invoked the check at all, so the run
  proved nothing about either of the two above. This one is the easiest to
  misdiagnose as the other two, because replacing a correct reader makes the
  symptom move without fixing anything.

The controls separate them, which is why they come first. Feed the check an
input it currently misreports and follow it all the way through:

- it never sees the value at all — then ask WHY before naming a culprit, because
  two of the three look identical here. If the value was never in the input set
  — an underinclusive glob, a query predicate that excludes the row, a directory
  the scan does not walk — that is the POPULATION, and extending the reader
  fixes nothing because the reader was never handed the thing. If the value was
  in the input and the reader could not parse or reach it, that is the READ.
- it sees the value and reaches the wrong verdict — the CLASSIFICATION.
- it reaches the right verdict and nothing comes out — the EMISSION. Trace the
  harness before concluding anything, since a fixture that never reaches the
  mechanism produces exactly the silence all three failures produce.

The first bullet is where a wrong turn costs most: "the check did not see it"
sends people to the reader by instinct, and a selector that excluded the row
will keep excluding it however good the reader becomes.

Do not substitute a thought experiment about what a human reader would conclude.
It misfires in both directions: a value built through an imported helper or a
runtime branch defeats a human restricted to the same input, while the defect is
still the READ; and a human bringing outside knowledge can spot a bad
classification the check reads perfectly. Run the input through the instrument
instead of predicting what someone would infer from it.

## A measurement standing in for a CATEGORY clears more than it checked

The commonest false clean is not a wrong measurement. It is a correct one
answering a narrower question than the claim it gets used for, which is why
re-running it never helps: the number was right, and the sentence built on it
was wider.

Three from this repository, arriving from unrelated directions:

- **"Zero queue depth" used as "not load."** It rules out BACKLOG — jobs
  waiting to start — and not much else. Workers that have all dequeued and are
  now competing for a lock, a CPU, a database connection or a disk leave the
  queue at zero while contention is exactly what is causing the timeout; and a
  runner intrinsically slower per unit of work is invisible to it entirely. A
  test dying at a timeout was declared a hang on the strength of a measurement
  that could not see either of the causes it was taken to exclude.
- **"The marker is present" used as "the commit landed."** It confirms that
  matching text exists in the scope searched, and nothing more. Unless the
  marker is UNIQUE to that commit and the search is scoped to the path it
  changed, text that was already in the base — or arrived independently —
  satisfies it while the commit is missing. `verifying-merged-work.md` says the
  same from the other side; the presence is evidence about the text, and the
  claim is about a change.
- **"The controls pass" used as "the findings are real."** It rules out the
  check being wrong on the shapes tested, not on the ones that produced the
  reports.

The tell is a sentence where the evidence names one thing and the conclusion
names a family: a queue, a marker, a control — against load, a merge, a set of
findings. When you notice it, do not look for a better number first. Name the
CATEGORY, list what else is in it, and ask which members the measurement can
actually see.

What narrows it is usually evidence that VARIES with the thing being claimed,
and "narrows" is the honest verb. The load case was constrained by a factor
appearing only where there was real work to be slow at — 4ms to 11ms on a
trivial test against 85ms to 5136ms on a rendering one. That is strong evidence
for per-unit-of-work slowness, and it is NOT a proof: an input-dependent
deadlock reached only by the heavy fixture, or contention that begins above some
concurrency threshold, produce the same curve. Excluding those needs something
that varies workload and contention independently, or a look at the blocker
state while it hangs. What the curve did do is rule out the SIMPLE forms of
both — a hang that stalls regardless of input, and contention already present
at rest — and that was enough to move a wrong diagnosis, which a single timing
at the ceiling could not have done however precise.

## For an ADVISORY check, firing on correct code is worse than missing

Read the scope first, because the asymmetry inverts and the inverted case is a
security hole rather than a style preference.

**Classify by what a MISS costs, at the call site — never by the check's form.**
"Lint" is a shape, not a consequence. This repository's `gitleaks` hook is a
lint by every structural measure and a mandatory security gate by consequence:
a miss puts a credential in a commit, and the repo forbids bypassing it. A
taxonomy that sorted by form would drop it in the advisory bucket and then tell
you to prefer the miss.

**An advisory check** is one whose false negative costs only the defect it
failed to report — a convention guard, a dead-code or dead-class warning, a
style rule. There a false positive costs the GUARD: it gets suppressed, worked
around, or deleted, and takes its true positives with it. The two are not
symmetric, and where they conflict, prefer the miss.

**A precondition must not be widened, whatever it looks like.** Authorization,
ownership, validity, quota, release gating, secret scanning, anything guarding a
destructive or irreversible operation: there a miss PERMITS the prohibited
action while a false positive merely rejects a valid one, so accepting misses
converts a cost saving into a hole. `AGENTS.md` already says preconditions run
first whatever they cost; this is the same instruction from the other side. When
such a guard cannot decide, it must fail CLOSED and say why, never widen until
it stops objecting.

The question to ask is therefore never "what kind of check is this" but "what
gets through if this one stays quiet, and who is relying on it not to".

The rest of this section applies to the advisory case only.

It decides what to do when a property is **not decidable from what the check can
see**, which is common and is not a failure. Do not add another exception each
time one is found; that is the third-finding shape above, wearing the costume of
thoroughness. Instead:

- Widen the SUPPRESSING condition — the exemption, the evidence that a report
  is unwarranted — so it cannot have gaps, accepting misses. Check the polarity
  before applying this, because it inverts: widening the REPORTING predicate
  produces more false positives, which is the opposite of the goal. "What
  excuses a finding" is the thing to make gap-free; "what triggers one" is not.

  Prefer a PREFIX or a structural property over a list of spellings — a list of
  Tailwind border widths must keep up with `border-2`, `border-x`, the logical
  `border-s`, arbitrary `border-[3px]` and whatever ships next, and every gap
  reports a caller's deliberate border as dead. "Is any other border utility
  present" cannot have that gap — and note that this IS the suppressing side:
  finding a border is what excuses the colour, so widening it silences more.

- Say in the file which direction the check errs in, and why. An
  under-reporting guard that documents itself is honest; one that silently
  drifts toward under-reporting is the same code with the reader misled.

State the remaining boundary rather than covering it badly — and where you can,
REPRESENT it in the output rather than only in a comment. A documented
limitation still emits the same nothing for "checked and valid" as for "not
checked", so CI, the next reader and any downstream consumer go on treating an
unexamined input as a clean one; prose in the file does not reach them.

Give the unchecked case its own value: a third state beside pass and fail, a
`skipped` count the run prints, a `{ known: false }` in the result. Then a
caller that needs certainty can ask for it, and one that does not can carry on —
which a comment cannot arrange. Only when the shape genuinely admits no third
state does naming the limitation become the whole remedy, and then say so
explicitly rather than leaving it as the default.

And classify at the CALL SITE, not at the definition. A shared helper does not
acquire one kind: a caller that logs a warning and a caller that gates a write
are an advisory use and a precondition use of the same function, both live at
once. A definition-level label is therefore worse than none, because "this
helper is advisory" invites the widening above — safe for the first caller,
a hole in the second, and the note at the definition still reads correctly.

This is the same unit the `catch` section below audits, and for the same reason:
the direction of a fallback is a joint property of the check and what the caller
does with its answer. When a check gains a caller, classify that caller.

## A bare `catch` is only a defect when its fallback makes a CLAIM

`catch { return conservative }` that degrades to caution is sound for the
failures it was written for, and this repo has several that are deliberately
so. It stops being sound when the same `catch` also swallows a failure that is
not about the data at all — a bad credential, a missing config, a dropped
connection, a `TypeError` in the handler. Those come back as "be cautious",
which blocks valid work while naming no cause, and the wider the catch the
longer that takes to find. Catch the errors you mean, and let an unexpected one
be seen: rethrow it, or log it with its code before degrading.

`catch { return verdict }` that
asserts something about the user's data manufactures a confident wrong
diagnosis — and it poisons every test asserting the negative outcome, because
those tests go green on the strength of _some_ error rather than the right one.

**The direction is a joint property of the fallback and the CALLER's use**, so
the unit to audit is the call site. The live risk for a well-documented shared
helper is gaining a second caller with the opposite polarity, where the
comment above it still reads correctly and nothing at the definition looks
wrong.
