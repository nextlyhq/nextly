# Verification policy (definition of done)

When a task-implementation skill or plan already specifies how to verify this
particular task, follow that first. This file is the fallback and the general
principle behind those, not a replacement for something more specific.

## Reviewing a spec or plan before presenting it

Before presenting a spec or plan to the requester — not after — re-read it
with fresh eyes, as if someone else had written it: look for gaps, internal
contradictions, vague or unverifiable requirements, and anything a reviewer
would flag. Fix what you find, then present it. Where `discovering-a-feature`
or `writing-plans` already has its own self-review step, this is that same
step, not an additional pass on top of it.

## An implementation is not done until

- every acceptance criterion in the spec or task is backed by evidence, not an assertion;
- the change is on the PR branch, not only described in a plan;
- the narrowest CORRECT verification for what changed has been run and read — not assumed;
- required CI is green at the verified PR HEAD (`.claude/rules/reading-a-ci-verdict.md`);
- no unresolved high-confidence review finding remains (`resolving-pr-feedback` skill);
- compatibility/migration requirements from the spec are satisfied;
- the PR is merge-eligible under `docs/agent/autonomy-policy.md`'s tier for this change.

Do not stop merely because implementation is complete, a PR exists, or local
tests pass once.

## Checks to run when a task is complete

At minimum, run build, lint, and format checks scoped to what changed (see
"Why there is no blanket Stop hook" below for why this is scoped rather than a
full-monorepo run). Beyond that minimum:

- **Schema or database migration changes**: if the migration would run against
  a LOCAL database, ask for approval before running it — state plainly what
  the migration does and what it could do to data already there, per
  `docs/agent/autonomy-policy.md`. After it runs, explicitly test for data
  loss and persistence — the data that existed before is still there
  afterward, in the shape the migration intended — not just that the
  migration command exited 0.
- **UI-facing changes**: see "Runtime/visual verification" below.

## When a plan is complete, live end-to-end test the whole flow

Once every task in a plan is complete, and the database being used is LOCAL,
run a live end-to-end pass with Playwright through the running app — not only
the unit/integration suites for the specific pieces that changed. Cover:

- the complete flow of the feature or plan just finished, start to finish, as a real user would go through it;
- the existing, adjacent features it touches or sits next to — to catch a regression the new work introduced, not only the new feature in isolation.

The goal is confirming there is no functional bug or breakage anywhere in the
full flow, not merely that the new code's own tests pass in isolation. Use the
dev harness (`pnpm dev:app`, or the relevant dialect variant) against a local
database for this — never a shared, staging, or production database. If the
database for this plan is NOT local, say so and fall back to whatever
verification IS available, per "Ask for manual review whenever automated
verification isn't enough" below.

## Why there is no blanket "run full build + lint + test" Stop hook here

`AGENTS.md`'s own Build-and-test section documents that `pnpm check-types` and
`pnpm lint` both need a build first, and a correct build of one package means
building it WITH its dependencies (`pnpm --filter <pkg>... build`). Running
that — or a full `pnpm build`, which builds every package in dependency order
— on every single turn's Stop event would make ordinary exploratory work
prohibitively slow in this monorepo. Instead:

- the `.claude/hooks/format-on-write.sh` PostToolUse hook formats each edited
  file immediately (cheap, per-file, no build required);
- `working-the-next-task` and `resolving-pr-feedback` run the narrow, correctly
  SCOPED verification for what actually changed, per AGENTS.md's own guidance;
- Husky's pre-commit/pre-push hooks and the `fallow-gate.sh` PreToolUse hook
  remain the deterministic backstop before anything reaches `main`.

If a future change makes package-scoped builds cheap enough (better turbo
caching, a faster CI-equivalent local check), revisit this — but change it
here, in one place, rather than letting each skill grow its own opinion about
when to run a full build.

## Runtime/visual verification

Any user-facing UI change needs a pass from the `ux-investigator` subagent
(or Playwright directly) covering light AND dark mode and at least one mobile
viewport, per AGENTS.md's admin-styling convention — OR ask the requester for
a manual review, whichever actually fits the change. Prefer asking for manual
review over a Playwright pass for anything highly visual, subjective, or hard
to assert on automatically (an aesthetic judgment, a "does this feel right"
interaction) — an automated pass there only proves the DOM rendered, not that
the thing being checked is actually correct. A change with no user-facing
surface (an internal refactor, a backend-only fix) does not need this step —
do not add it as a ritual.

## Ask for manual review whenever automated verification isn't enough

This generalizes beyond UI. Do not stretch an automated check to cover
something it does not actually verify. Whenever an automated check cannot
meaningfully confirm the property that matters — a subjective judgment, a flow
that needs a human reaction, a behavior only observable in a real environment
you don't have access to — say so plainly and ask for a manual review instead
of declaring the task done on the strength of a check that didn't really test
it.
