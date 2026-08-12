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

## Derivation cannot see DELETION, and the green looks identical

Deriving fixes drift. It does not fix removal, and those are different failures:

- **The subject gains a member the check forgot** → deriving fixes this, but
  only when the derivation is TOTAL. Read the whole manifest and every new member
  gets a case the moment it exists. Reach it through a glob, a predicate or a
  filter and a member landing outside that selection still generates nothing —
  the derivation has merely moved the hand-kept list into a pattern.
- **The subject LOSES a member** → still silent, always. The derived population
  shrinks with it, every remaining case passes, and the suite reports green over
  a subject that stopped doing something.

A derived check inherits its subject's blind spots: it can only assert about
what the subject currently says. Removing the subject removes the assertion —
and removes its test alongside, so the count drops without a failure.

So a derived check needs three things, and is usually written with one:

1. **Derive the population** from the richest source available — the manifest,
   the registry, the config — not a hand-kept copy of it.
2. **Assert the derivation is complete**, against that raw source and against
   zero. With `raw` the source as read — usually an object, so count the same
   key population on both sides rather than reaching for `.length` on one:

   ```ts
   const population = Object.keys(raw);
   expect(derived).toHaveLength(population.length); // no narrowing transform
   expect(population.length).toBeGreaterThan(0); // the source was really read
   ```

   The first catches a glob or predicate quietly selecting a subset. The second
   catches the collapse where the read returns nothing and every remaining case
   passes over an empty matrix — without it, `toHaveLength(0)` against an empty
   source is a green that asserts nothing.

3. **Pin by name the members whose absence would itself be the regression.**

Each answers a different question. Deriving answers "did we forget to check
something that exists". The completeness assertion answers "is the derivation
still seeing everything" — without it, step 1 has only relocated the hand-kept
list into a pattern nobody rereads. A by-name pin answers "did something stop
existing", which neither of the others can see.

Worked example, from this repo. `packages/nextly/src/__tests__/export-contract.test.ts`
hand-listed 6 entry points while `package.json` published 42, and pinned the
expected count beside the list it counted — so both sides moved together and a
new subpath was never checked.

It now does all three. The matrix comes from `Object.keys(manifest.exports)`,
which is TOTAL — the whole manifest, with no predicate or glob between, which is
what makes the addition case genuinely closed rather than merely relocated. Its
length is then asserted against `declaredSubpaths.length` and against zero, so a
mapping that silently selected a subset, or none, fails instead of deleting its
own cases.

And it still carries one hardcoded assertion:

```ts
expect(declaredSubpaths).toContain("./field-group-type");
```

because the derived matrix would pass just as happily if that subpath were
dropped from `package.json` — the published surface would simply be described as
smaller. That entry point is the supported way to read a field group's type, and
its absence sends callers back to reading the raw storage key by hand, which is
the defect the whole rename exists to remove. Deriving cannot express that; only
naming it can.

The same shape applies to a derived check over routes, over registered field
types, over dialects in a matrix: derive so nothing new escapes, then name the
one or two whose disappearance is the thing you are actually afraid of.

The general case of that pin is older than this rule and already in the same
file, which is the best argument for it. A prohibition — "no entry point exposes
these 22 names" — is satisfied PERFECTLY by an empty module, so it is paired
with an assertion that the replacement API is present:

```ts
// The counterpart to the list above: absence alone would also be satisfied
// by deleting the API, so the replacements are asserted present.
expect(typeof cfg.defineFieldGroup).toBe("function");
```

That counterpart is the half that gets skipped, because a prohibition passing
feels like the check working. It is not unconditional though, and demanding it
everywhere would contradict the pin rule above: a subject that may legitimately
be empty — a feature-gated plugin registering no routes — has no required
replacement to assert, and inventing one manufactures a contract the system does
not have. Pair the prohibition with a presence assertion exactly when emptying
the subject would itself break the contract, which is the same test as deciding
what to pin by name.

## A pattern matching a common word is a narrowing check in reverse

The separating-property test has a mirror image. A check can also fail by
matching too MUCH, and it fails more convincingly, because a hit reads as
evidence while a miss reads as nothing.

Measured here, scanning every open PR for the 22 forbidden identifiers in
`export-contract.test.ts`. **Three successive refinements, each of which felt
like rigour, and all three were unsound in the same direction:**

| pass                                            | result                              | sound? |
| ----------------------------------------------- | ----------------------------------- | ------ |
| substring match on added lines                  | 10 PRs flagged                      | noisy  |
| ...restricted to lines containing `export`      | 4 lines, one PR, all prose comments | NO     |
| ...word boundary, dropping `component`          | 0                                   | NO     |
| all 22 names, word boundary, **every hit read** | 43 hits, all prose, **0 real**      | yes    |

Each middle pass is worth naming, because they are the same mistake escalating.

**Filtering to lines containing `export`** drops the case it exists to catch: a
re-export inside a block puts the binding on its own line, so `  ComponentConfig,`
carries no `export` at all.

**Dropping `component` from the list** was worse, and it was mine. The
justification was that it is an ordinary English word producing only prose hits —
true of the hits, and irrelevant to the question. `component` is itself one of
the 22 forbidden exports, so the refined scan could no longer see a PR
re-exporting it. **The refinement excluded exactly one name, and it was the one
most likely to be re-exported by accident**, being the shortest and most natural
to reach for.

So the clean zero was produced by a scan that had been narrowed until it could
not fail. That it agreed with the honest answer is luck, and the agreement is
what would have stopped anyone looking.

The sound method was the unglamorous one: keep all 22, accept 43 hits, and read
them. **A count is not a finding until something has looked at what it counted**,
and "I filtered it" is not the same as having looked.

An identifier list containing an ordinary word is the tell. Match at a
granularity the language distinguishes — a parsed binding, not a regex — or read
every hit. Do not drop the awkward name; the awkward name is why the check
exists.

The generalisation is worth more than the instance: **when you refine a check,
ask what the refinement EXCLUDES, not only what it admits.** Three refinements of
one scan in one day, by two people, all narrowing the question rather than
sharpening the answer — one restricted the path set, one the line set, one the
name set.

A refinement that cannot be stated as "this excludes X, and X cannot matter
because Y" is a guess wearing the costume of precision. Note that the third
refinement CAN be given that sentence — "this excludes `component`, and
`component` cannot matter because its hits are prose" — and the sentence is
false. Writing it down is what exposes it; the excluded thing has to be checked,
not merely named.

Worth separating the SCAN from the GUARD here, because conflating them nearly
put a false limitation into this file. A diff-text scan cannot see
`export * from "./legacy-module"` — the forbidden name never appears in the
diff. The suite is unaffected: it imports each entry point and asks
`name in mod` against the live namespace object, and export-star bindings are
present on that namespace (measured, not assumed). So the blind spot belonged to
the pre-warning heuristic, not to the check that actually protects the package.
When something looks like a hole, establish WHICH layer it is in before
describing it as one.

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

**A commit's author field is one of these, and it is the one most likely to be
believed**, because it looks like provenance rather than like a string somebody
chose. It is a login, and in this repo many agents commit under one. Measured
over the last 400 commits: 343 carry a single identity.

And it is not a credential in any checkable sense either: the name comes from
environment or configuration, so it is chosen rather than authenticated, two
contributors can pick the same one, and one contributor can change theirs. So it
does not reliably separate contributors, and it certainly does not separate the
concurrent sessions sharing a single configured identity — that distinction was
never recorded anywhere.

Two different questions, and only one of them has a sound instrument:

- **"did this line predate that change?"** — a fact about the tree, and
  `git show <ref>^:<path>` answers it for the ordinary case: a single-parent
  commit where the path did not move. `^` selects the FIRST parent only, so
  across a merge it cannot see a line that arrived on another branch, and it
  looks the path up verbatim, so a rename reads as absence. Where either
  applies, check each parent and follow the rename (`git log --follow`) before
  claiming precedence.
- **"who wrote this line?"** — `git log --format=%an` answers a question about a
  credential. Under a shared one it is a guess with a citation attached, which
  is worse than an obvious guess.

This surfaced while attributing a comment in `export-contract.test.ts`. The
precedence claim was settled from the tree and held; the authorship claim around
it could not have been settled at all, in either direction. `gh pr list --author
@me` has the same shape — it filters by credential and reads as ownership.

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
