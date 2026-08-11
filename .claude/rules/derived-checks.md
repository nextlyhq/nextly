---
paths:
  - "packages/**/*.ts"
  - "packages/**/*.tsx"
  # admin-css ships its product code and its tests as .mjs, and several package
  # build scripts are .js/.cjs. They implement checks like any other package, so
  # a TypeScript-only filter would exempt exactly the code this rule is about.
  - "packages/**/*.mjs"
  - "packages/**/*.js"
  - "packages/**/*.cjs"
  # The changeset package list versus the release group is one of this rule's own
  # examples, so it has to load when those inputs are edited too.
  - ".changeset/**"
  - "scripts/**"
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

- classify a driver failure by SQLSTATE **class**, not a list of codes;
- find a database object by the **column set it covers**, not by its name — an
  engine appends `_2` on collision and truncates at its identifier limit, so
  there is no single string to match;
- decide a capability by **probing it on a scratch object**, not by reading the
  server's version — the platforms worth detecting are the ones that misreport;
- decide indexability by asking the **shared rule**, not by restating which
  types a dialect can key;
- confirm a merge by **comparing the object**, not by grepping for a marker
  that may occur elsewhere.

The tell is a check whose correctness depends on how some other system chose to
spell something. Ask instead what property makes the answer true, and query
that. It is usually available and it usually costs the same.

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
