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
