# Agent autonomy policy

This is what lets an agent stop asking for permission without being given
unlimited decision rights. It is imported into `CLAUDE.md` and linked from
`AGENTS.md` so both Claude Code and Codex read the same rules.

It supersedes the `reviewing-a-pr` skill's blanket "Default policy: the
founder merges" line: that skill still owns _how_ to triage bot feedback, this
file owns _who_ is allowed to press merge and when a decision must come to the
requester first.

## Ask first — no exception

Whenever this file says a decision or approval is required, the agent asks
**before** doing the thing, not after, and not while also doing it as a
fallback. Until an explicit approval is given, the agent does not proceed —
not with a "reasonable default," not with a reversible version "just to show
the option," not with any part of the change. A partially-applied change made
while waiting for an answer is itself a thing done without approval.

"Explicit approval" means the requester affirmatively agreed to the specific option
presented. Silence, no response yet, a reply about something else, or moving
on to a different topic is not approval and does not license proceeding.

## Changing anything that already exists

Separately from new work, if a change would modify, alter, or replace an
**existing** behavior, workflow, configuration, convention, or established
approach — a file already in the repo, a setting already in place, a process
already being followed, including this policy document itself — that change
needs explicit approval first, regardless of how small or reversible it looks.
This is stricter than "resolve independently" below: that section is about
decisions inside NEW work being written, not about touching something that is
already established. When genuinely unsure whether something counts as
"already established" versus "a detail of the new work," treat it as
established and ask.

## Starting a new module

Before starting a new module — a new package, a new top-level feature
directory, a new significant subsystem; not just another file inside a module
that already exists — either:

- ask what folder structure to use, presenting the reasonable options if more than one exists; or
- follow the folder structure and instructions already specified by the task-implementation skill or plan being executed, when one already specifies it.

Do not invent a new module's layout unilaterally when neither of those is
available. Ask, per "Ask first" above.

## How to present a decision

A question asking for approval states, in plain and simple language:

- the current situation, briefly, with enough concrete detail to understand what's actually at stake;
- the available options, each described plainly enough to compare without having to go read code or logs first;
- the likely impact of each option — what changes, what it costs, what it risks;
- a recommendation, clearly marked as a recommendation and not as the decision already made.

Prefer a short, concrete question over an exhaustive one. If more than a
handful of options exist, narrow to the ones that are actually reasonable and
say why the others were set aside.

## Resolve independently

For NEW implementation details — not for anything already established, see
above — no need to ask about:

- naming, file layout, and test structure with established repository precedent;
- a reversible refactor, or a small dependency-free abstraction;
- a library or pattern already used elsewhere in this repo for the same problem;
- a bug fix whose correct behavior is already established by nearby code, tests, or docs;
- review-bot feedback (CodeRabbit, Greptile, Codex) that can be objectively verified against the code or a test.

## Ask for a decision

Ask — using the format above — and **wait for an explicit answer before
proceeding** when:

- the requirement implies materially different user-facing outcomes and no precedent decides between them;
- an irreversible or destructive migration is proposed;
- a change would knowingly break backwards compatibility on a published package's public export or wire shape;
- it needs a new paid external service, a dependency with real license/security implications, or another infrastructure commitment;
- it changes an auth, permissions, or security posture;
- two architecturally defensible directions exist with materially different long-term consequences;
- required credentials or access are missing and cannot be obtained;
- it would modify, alter, or replace an existing behavior, workflow, configuration, or established approach, per the section above.

Everything else in this list is `NEEDS_HUMAN_DECISION` wherever it shows up in
a review finding too, not just at design time.

## Risk tiers

| Tier     | Examples in this repo                                                                                                                                                     | Agent authority                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Routine  | docs-only, test-only, internal refactor with existing coverage, changeset-exempt PRs                                                                                      | Implement → pass review → merge → verify                                        |
| Normal   | a feature within existing architecture and package boundaries                                                                                                             | Implement → pass review → merge once every gate below is green                  |
| Elevated | a package's public export surface, cross-dialect persistence/schema, anything under `packages/nextly/src/auth/**`, a change that reaches around the `plugin-sdk` boundary | Implement to merge-ready, then stop for the requester's explicit merge approval |
| Critical | a destructive/irreversible migration, secret or credential handling, payment or billing logic                                                                             | Stop before implementation too — bring the decision to the requester first      |

When unsure which tier applies, default to the higher one and say why.

## Opening a pull request

A PR is opened only when:

- a skill whose documented process explicitly includes opening one is being followed, and that skill's run was itself asked for or approved by the requester; or
- the requester explicitly asks for a PR to be opened for this specific piece of work.

Never open one "to make progress visible" or "since the code is ready" as a
default — that is exactly the kind of unasked-for action this policy exists to
rule out.

## Merging a pull request

A PR is merged only when the requester explicitly instructs it, asks for it, or
otherwise makes that decision for that specific PR — never automatically,
however green the checks are, and never as a documented-but-unconfirmed step
of a skill. The preconditions below must ALSO be true before that instruction
is asked for or acted on; they are necessary, never sufficient, and never a
substitute for the explicit instruction:

- the tier is Routine or Normal;
- every acceptance criterion is backed by evidence (a test run, a command's output, a screenshot for UI);
- required CI is green **at the verified PR HEAD**, using the method in `.claude/rules/reading-a-ci-verdict.md` — derive the required jobs, assert `success` on each, never infer green from "no failure was reported";
- Codex's review at that HEAD carries no unresolved P0/P1 finding, and every CodeRabbit/Greptile finding has been triaged per the `reviewing-a-pr` skill;
- the merge itself goes through `.claude/rules/verifying-merged-work.md`'s `--match-head-commit` precondition — never `--admin`;
- the PR is not marked `requires-human-product-review` or similar.

## Otherwise

When the requester has not given that instruction, or any precondition above is
unmet: prepare the PR fully — description, evidence, changeset if one is
needed — and stop at **MERGE_READY**. State plainly which condition is unmet,
or that the PR is ready and awaiting the explicit instruction to merge.
