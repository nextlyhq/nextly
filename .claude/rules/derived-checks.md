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

## The THIRD finding of one shape is about the check, not the instance

Two findings that rhyme are a coincidence. The third is a measurement: the check
is built on something that cannot answer the question, and fixing instances will
keep producing findings for as long as anyone keeps looking. Every fix is
correct, every one is followed by another, and the reviewer and the author both
read the sequence as progress.

So at the third, stop patching and ask which of two things is unreliable,
because the remedies are different and applying the wrong one looks like
diligence:

- **The READ** — the check cannot see what it is looking at. Replace the
  instrument, do not extend it. A regex over source becomes a walk over the
  compiler's AST; an AST prediction of a runtime value becomes the runtime value
  itself. Worked example: a source check for a component's class names took
  thirteen rounds finding spellings it read wrongly — aliases, namespace
  imports, `{...{ className }}`, `+` concatenation, template interpolation,
  character references. Each fix was right. The surface it was covering was the
  whole language, so the only end was to stop predicting the string and read it
  where it already exists.
- **The CLASSIFICATION or the POPULATION** — the check sees correctly and
  decides wrongly, or looks at the wrong set. Identify by structure rather than
  by a proxy, or enumerate the members instead of counting them. Worked example:
  an exemption allowing "one detached pager in this file" excused whichever
  pager came first, because two pagers on one page can be identical in every
  respect the check could see. Deleting the exempt one and detaching a different
  one left the count unmoved and every assertion green. Naming the exempt pager
  fixed it; a bigger allowance never would have.

The tell that separates them: ask whether a human reading the same input would
get the right answer. If yes, the read is at fault. If a human would also have
to guess, the classification is.

## A guard that fires on correct code is worse than one that misses

A miss costs whatever the defect costs. A false positive costs the guard — it
gets suppressed, worked around, or deleted, and takes its true positives with
it. The two are not symmetric and should not be traded off as if they were.

This decides what to do when a property is **not decidable from what the check
can see**, which is common and is not a failure. Do not add another exception
each time one is found; that is the third-finding shape above, wearing the
costume of thoroughness. Instead:

- Widen the condition so it cannot have gaps, accepting misses. Prefer a PREFIX
  or a structural property over a list of spellings — a list of Tailwind border
  widths must keep up with `border-2`, `border-x`, the logical `border-s`,
  arbitrary `border-[3px]` and whatever ships next, and every gap reports a
  caller's deliberate border as dead. "Is any other border utility present"
  cannot have that gap.
- Say in the file which direction the check errs in, and why. An
  under-reporting guard that documents itself is honest; one that silently
  drifts toward under-reporting is the same code with the reader misled.

State the remaining boundary rather than covering it badly. A named limitation
is a check whose silence means something; an unnamed one is indistinguishable
from coverage.

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
