# Follow-up: hardening related-row field access against adversarial `afterRead` hook reshaping

Follow-up to **#477** (merged as `302264b9`). #477 landed rounds 1–15 of the
nested field-access hardening; this document tracks the remaining class of edge
cases (codex review round 16, six P1 findings) and the architectural decision for
closing it.

## Context

When a document is read with relationships expanded, each related row belongs to
another collection and carries **that** collection's field `access.read` rules.
#477 makes nested reads apply those rules faithfully — a field masked on a direct
read of the target stays masked when the same row arrives nested inside another
document — across the full matrix of `afterRead` hook behavior: copy-leak,
reintroduction, condition flip-flop, appended/replaced/reordered/mutated repeater
rows, in-place mutation, id collision, source-collection re-contamination,
reshaped-document responses, JSON string containers and JSON-backed relations,
system-entity secrets, override-mode secret stripping, unmatchable/id-less clone
fail-close, repeater-by-id evidence matching, stale-evidence clearing,
whitespace-prefixed JSON decode, in-place nested-replacement fail-close, and
between-source-phase re-sanitization.

The **final architecture** (defend this; do not naively undo it) — see the code
comments in `collection-relationship-service.ts` / `field-level-registry.ts` and
the detailed history in the private handoff `tasks/HANDOFF-2026-08-02-477-*.md`:

- Apply each child's field access **before** its parent's hooks (matches a direct
  read; a parent hook can't read a denied child field to copy it).
- **Re-judge** each row against its current content after every hook — never cache
  a verdict. Id-keyed **evidence** is fine; id-keyed **verdicts** are not.
- Restore each row's removed values as **evidence** before re-judging (keyed by row
  object, and by `(collection,id)` for clones), over the whole subtree before any
  ancestor snapshot; strip restored evidence after judging unless the post-hook row
  actually supplied it.
- **Fail closed** (deny every `access.read` field, via `state.failClosed`) when a
  related row's redaction provenance can't be established — an unmatchable, id-less,
  or reshaped clone. Match cloned repeater rows by `id` (groups by field name);
  record original nested rows so an in-place root's replaced/appended nested rows
  fail closed too.
- Run the authoritative `resanitizeAssembledRows` re-walk after **every** source
  `afterRead` phase (code → stored → field-level) and before selection.

## The round-16 findings (all verified real)

The exploit descriptions are on the #477 review threads (public). All six are
further permutations of one theme: **a source hook reshapes a related row past the
piecemeal evidence-reconciliation the re-walk performs.**

1. **Fail-close ancestors of unmatched container rows** — a root-level rule can
   inspect a nested repeater via the root snapshot; failing the child closed does
   not stop the ancestor rule from falling open on the replaced subtree.
2. **Re-sanitize existing children after target hooks** — the post-target-hook
   re-descent reuses `visited`, so an existing child a target hook mutated in place
   is skipped and stays reintroduced while an ancestor hook runs.
3. **Reject duplicate repeater ids during evidence transfer** — the `byId` map
   keeps only the last row per id; duplicate ids alias evidence across rows.
4. **Fail-close replaced group objects** — groups are reconciled by fixed position,
   which cannot tell a deep clone from a wholesale replacement, so a replacement can
   inherit the original group's permissive denied evidence.
5. **Recheck cloned subtrees after every hook phase** — with per-phase
   re-sanitization, a clone with any root redaction is skipped by the
   `!redactions.has(root)` guard on later phases, so a nested row replaced between
   phases is neither matched nor failed closed.
6. **Redact source rows before late field hooks** — a _source-field_ regression,
   distinct from the related-row class: moving selection after the field-level
   `afterRead` phase now exposes unselected/denied **source** siblings to those
   hooks, which can copy a secret onto a selected allowed field before the root
   access pass strips only the original key.

## Why this is a follow-up, not more rounds on #477

The incremental loop is **not converging**: findings per round went 3 → 4 → 6, and
round 16 includes edges introduced by the round-15 and round-10 fixes themselves
(items 5 and 6). Reconciling hook-mutated related rows piecemeal has effectively
unbounded permutations. #477 already closes the primary exposure; these remaining
items require adversarial hook authoring (deep multi-level relationship chains,
deliberate reshaping/replacement), so they were split out to be closed as one
coherent change rather than an open-ended review loop on the main PR.

## Decision to make here

Close the class with **one unifying rule** rather than continued piecemeal fixes.
Candidate approaches (decide, then implement + test-drive + verify-by-break):

- **A — Unify: any hook-touched related subtree fails closed (recommended).**
  After source hooks, any related row whose subtree was reshaped, replaced, or
  mutated beyond in-place edits that preserve object identity has **all** its
  access-controlled fields denied at every level, including ancestors. Subsumes
  items 1–5 with one rule; ends the loop; fail-secure. Cost: a hook that reshapes a
  related row (even a benign immutable spread) loses that row's protected fields —
  heavier over-stripping; needs a clear dev-mode warning and docs ("transform
  related rows in place and preserve identity, or they are treated as untrusted").
- **B — Freeze related rows before source hooks.** Deep-freeze each sanitized
  related row so hooks cannot alter related-row visibility at all. Clean invariant,
  but silently breaks legitimate related-row transforms and reshaped-response hooks.
- **C — Continue incremental.** Fix items 1–5 individually. Preserves the most field
  visibility, but the loop has not been converging.

Item **6** is a distinct source-field regression and must be fixed regardless of the
choice above: give the field-level `afterRead` hooks a view without source fields the
caller cannot read (denied or unselected), while preserving whole-row **evidence**
for rule evaluation.

## Pointers

- Merged PR: #477 (`302264b9`). Round-16 threads: on #477 (resolved with this
  deferral note).
- Private handoff with full round-by-round history and invariants:
  `tasks/HANDOFF-2026-08-02-477-nested-access-and-watcher.md` (§2, §R14, §R15, §R16).
- Recommended starting point: Option A, test-driven, with verify-by-break per item.
