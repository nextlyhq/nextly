---
name: testing-evidence
description: >-
  Use when adding, changing, deleting or judging a test in the Nextly monorepo,
  or when deciding whether a passing test proves anything: break-verification
  and what counts as the intended failure, compile-time contract tests and the
  @ts-expect-error trap, naming the property that separates a correct
  implementation from a plausible broken one, and when removing a test is right.
---

# What makes a test evidence in the Nextly monorepo

- A test is only evidence once you have seen it FAIL for the intended reason.
  Break the code, confirm the intended test fails, restore. After changing a
  test, re-run its break: a fix to the test is a change to the experiment.
  What counts as the intended failure depends on when the test runs:
  - A RUNTIME test that stops COMPILING proves nothing — the assertion never
    executed, so the red says only that the break was malformed.
  - A COMPILE-TIME contract test is the opposite case: compilation IS the
    mechanism. In `*.test-d.ts`, widening a type makes its `@ts-expect-error`
    unused and `check-types` fails for exactly the intended reason. Red is not
    the evidence though — the EXPECTED DIAGNOSTIC is. A typo, a bad import or
    an unrelated type error in the same file all stop compilation too, and
    prove nothing about the property.
  - `@ts-expect-error` is the sharp edge here, because it suppresses ANY error
    on the line that follows. A test asserting "this call is rejected" stays
    green once the code starts erroring for a different reason, and stays green
    after the original rejection stops happening. Two things that look like
    mitigations and are not: a comment naming the expected code, which `tsc`
    never reads; and a positive control asserting the ACCEPTED form still
    compiles, which an unrelated error confined to the rejected line leaves
    untouched. Only an assertion the checker EVALUATES distinguishes the cases —
    `expectTypeOf(...)`, or a diagnostic-aware type test that names the error it
    expects. If the property cannot be asserted that way, say in the file that
    the directive is unverified rather than letting it read as coverage.
  - The count must not drop by ACCIDENT: a suite that silently stopped being
    discovered reads as a pass, which is what that guards. Removing a test on
    purpose is a different act, sometimes correct (below), and the PR says
    which test went and why.
- Before you assert or measure, name the property that SEPARATES a correct
  implementation from the plausible broken one you are worried about, and check
  that it is the property you are about to test. A necessary-but-insufficient
  property returns green from both, and it does so carrying the authority of
  having been checked, which closes the question. Two worked examples, both real:
  - measuring whether an old database constraint could be DROPPED, when what
    decides the repair is whether the code can FIND it. Dropping succeeded, and
    the repair would still have skipped every database silently.
  - asserting a generated identifier is `length <= 63`, when a plain truncation
    is also 63 characters. The one test guarding the naming passed on the broken
    implementation; distinctness was the separating property.

  The operational form is to ask what ELSE would produce the same green. If
  anything other than the property under test does — a fixture that never
  reaches the mechanism, an unregistered type falling through to a default, an
  assertion satisfied by absence, a search whose glob missed the directory —
  the property is not covered yet. Add the positive control that makes the
  mechanism's presence observable, and run it.

- Whatever you are currently judging WITH is not being judged. A probe, a
  derived check, a test, a post-apply verifier and the baseline diff that reads
  the suite all had the same defect in one week here, and every one of them
  existed to catch the layer above it. They were hard to see not because the
  defect was subtle but because each occupied the position auditing is done
  from, so nothing stood further out to look at it. Periodically step out one
  level and give the instrument the same treatment as its subject: a positive
  control on an input where you know the answer, and where the answer is not
  "nothing". Confirming an instrument against a case that did not move cannot
  distinguish it from one that reports nothing under any circumstances.
- A test that passes both with and without the fix is worse than no test: the
  next reader takes the green as coverage. **Repair it first.** Usually the
  fixture never reaches the mechanism or the assertion is satisfied by absence,
  and both are fixable. Deleting the ONLY attempted coverage for a behaviour
  trades a misleading green for no signal at all, which is not an improvement.
  Deletion is right in two cases, and they need different notes:
  - **redundant** — the behaviour is genuinely covered elsewhere. Say in the
    file that remains WHERE, so the next reader can follow it.
  - **obsolete** — the code no longer does the thing. There is no remaining
    file, and demanding one would force a false coverage comment. Say what
    behaviour was removed and in which change instead.

  Either way this is the deliberate removal the count rule exempts, so state the
  drop rather than letting it look like a suite that went missing.
