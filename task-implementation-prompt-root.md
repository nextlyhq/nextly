# Task Implementation Prompt

**Active plan:** [`docs/superpowers/plans/2026-05-12-openapi-swagger-support-phase-1.md`](docs/superpowers/plans/2026-05-12-openapi-swagger-support-phase-1.md)
**Design spec:** [`docs/superpowers/specs/2026-05-12-openapi-swagger-support-design.md`](docs/superpowers/specs/2026-05-12-openapi-swagger-support-design.md)
**Active feature branch:** `feat/openapi-swagger-support` (off `main`, local-only)
**Workflow mode:** **Local-only — no sub-task branches, no PRs per task.** Implementer commits each task directly to `feat/openapi-swagger-support`. The feature branch is not pushed to origin during Phase 1; the only PR is the final integration PR `feat/openapi-swagger-support` → `main` when all phases are complete.

---

## Plan-Driven Execution Mode (local-only)

This prompt is currently configured for **plan-driven local execution** of the OpenAPI/Swagger support work. The design, competitor research, and architecture decisions are already complete and frozen in the spec; the plan breaks the work into 25 self-contained tasks (Phase 1) that must be executed in order. Each task lands as one commit directly on the feature branch — no sub-task branches, no PRs until final integration.

### What this means for the workflow below

| Generic phase                | Plan-driven override (local-only)                                                                                                                                                                                                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 1 — Understand**     | Read the **task section in the plan** (find your assigned `Task NN`) AND the spec sections it cross-references. Do NOT re-do competitor research — it's already in spec §3.3. Ask clarifying questions only if the task's intent is unclear, not to relitigate design decisions.                                                       |
| **Phase 2 — Design & Plan**  | **SKIP entirely.** The brainstorming and writing-plans skills have already run. Re-running them would re-litigate frozen decisions. The plan's task section IS the design.                                                                                                                                                             |
| **Phase 3 — Implement**      | **Stay on `feat/openapi-swagger-support`.** Do NOT create a sub-task branch. Ignore the plan's "Step 1: Branch" steps (they assume the PR workflow). Run all other steps in the task: TDD, code, tests, full check suite.                                                                                                              |
| **Phase 4 — Review & Merge** | **No PR.** Add the changeset per the task, then `git commit` directly onto `feat/openapi-swagger-support` with the task's Conventional Commit message. Run `superpowers:requesting-code-review` inline (self-review) before each commit if desired, but no GitHub PR is opened. `main` stays untouched until the final integration PR. |
| **Phase 5 — Complete**       | Run only after Task 25 (end of Phase 1) and again after Phases 2 + 3 plans land. Then proceed to "Plan Completion & Integration" below.                                                                                                                                                                                                |

### How to invoke this prompt for a single task

Tell your implementer:

> Execute **Task T<NN>** from the active plan in local-only mode. You are already on `feat/openapi-swagger-support`. Skip Phases 1–2. Skip the "Step 1: Branch" step in the task (no sub-task branch). Implement all other task steps. After tests pass and the changeset is added, `git commit` directly to `feat/openapi-swagger-support` using the task's Conventional Commit message. No `git push`, no PR.

### When NOT in plan-driven mode

If a task arrives that is unrelated to the OpenAPI plan (e.g., an unrelated bug fix), revert to the generic flow: Phase 1 includes brainstorming + writing-plans, Phase 3 branches off `main`, Phase 4 opens a PR to `main`. The plan-driven local-only overrides apply only while implementing the OpenAPI plan.

---

## About Nextly

Nextly is an open-source CMS for Next.js — similar to Payload CMS and Strapi, but with both code-first AND UI-first approaches. Users can define collections and singles/globals via code (like Payload) or via the admin UI (like Strapi/ACF in WordPress).

Nextly is approaching beta. The goal is to reach a stable beta release for community feedback.

---

## Source of Truth

The `nextly` folder is the ONLY source of truth for Nextly's codebase, APIs, and patterns. If an integration project does something differently, assume `nextly` is correct and follow it. Do NOT rely on integration projects for how Nextly works — they may be outdated or implemented by interns using older versions.

## Project Map

This workspace contains multiple independent git repositories:

| Folder        | Role                              | Integration Style                            |
| ------------- | --------------------------------- | -------------------------------------------- |
| `nextly`      | Nextly monorepo (source of truth) | —                                            |
| `codexspot`   | Integration project               | Not sure code-first or Visual Schema Builder |
| `mobeen-site` | Integration project               | Not sure code-first or Visual Schema Builder |
| `rext-site`   | Integration project               | not sure code-first or Visual Schema Builder |
| `21c-v3`      | Integration project               | Visual Schema Builder                        |
| `4re-v3`      | Integration project               | Visual Schema Builder                        |
| `nextly-site` | Nextly website + docs             | —                                            |

Each folder is its own git repo. Branch, commit, and PR within the task's target project.

### ⚠️ Integration projects are STALE references

The integration projects above (`codexspot`, `mobeen-site`, `rext-site`, `21c-v3`, `4re-v3`) were integrated against **older versions of Nextly**. Since then, Nextly has been heavily refactored — APIs, file layout, schema builder internals, runtime split, package structure, and conventions have all changed.

**Treat these projects as historical artifacts, not as patterns to copy.**

- Do NOT read them to learn "how to use Nextly" — they will teach you outdated APIs.
- Do NOT mirror their folder structure, imports, config, or types — assume drift.
- Do NOT cite them as examples of current best practice.
- DO use them only when the task explicitly targets that project (bug fix, migration, content update inside that repo).
- DO use them as a "what-could-go-wrong" signal — discrepancies between them and current `nextly` are interesting findings, not patterns.

If you find yourself wanting to reference an integration project for _how Nextly works_, stop and read `nextly` instead. If they conflict, `nextly` wins, every time.

---

## Hard Rules

### MUST

1. Read and fully understand the task file before doing anything else.
2. Research how competitors (Payload CMS, Strapi, WordPress/ACF, Directus, Sanity) handle the same problem — for EVERY task, regardless of type.
3. Use `nextly` as the sole reference for Nextly's codebase and APIs.
4. Use Context7 MCP plugin to fetch latest docs before writing any library code — resolve the library ID first, then query docs with your specific question.
5. Use superpowers skills at every required gate (see Execution Workflow below).
6. One sub-task at a time. Finish, verify, commit, PR, merge — then move to the next.
7. Build and lint MUST pass before any commit. Discover available scripts from `package.json` and run all relevant checks (build, lint, check, test, etc.).
   - **Pre-existing failures vs. new failures:** if `nextly`'s lint, type-check, or test suite already had failures on the base branch _before your changes_, those can be ignored — but you MUST flag them in the PR description so I know they exist. You MUST NOT introduce ANY new lint errors, type errors, test failures, or warnings. "It was broken before" is not a license to make it worse.
   - To distinguish: run the checks once on the clean base branch (or check CI status of `dev`) and once on your branch. Anything new on your branch is yours to fix.
8. Ask me when requirements are unclear. Quote the specific part and ask — don't assume.
9. Verify visually with Playwright MCP plugin for any UI-facing changes.
10. Document genuine findings, learnings, and issues in the `findings/` and `plans` folders.
11. When presenting approaches, asking questions, or discussing anything — be explanatory with examples so I can understand the reasoning, trade-offs, and decisions clearly.
12. Every question or proposed option MUST follow this structure (no shortcuts, even for "small" questions):
    - **Plain-English context** — one or two sentences explaining what's being asked and why it matters, written for a human, not in jargon.
    - **Options** — list each option with a short label, a plain-English description of what it actually does, plain-English pros and cons (not just "faster" / "slower" — say _why_ and _for whom_), and a concrete example showing how it would play out in this codebase.
    - **Honest recommendation** — pick one and say why. Push back on me if my preference looks wrong; do not rubber-stamp. Base recommendations on real research (nextly source, competitor research, Context7 docs), not vibes.
    - **What I need from you** — one clear line at the end stating exactly what decision you need.
13. **Changesets are mandatory for any user-facing change in `nextly`.** Nextly is approaching alpha and uses [Changesets](https://github.com/changesets/changesets) for versioning. Current version line is `0.0.x-alpha.x` (e.g. `0.0.1-alpha.0`). Before opening a PR that touches a published package:
    - Run `pnpm changeset` (or `npx changeset`) and select the affected packages.
    - Choose bump level: `patch` for fixes / docs / internal tweaks, `minor` for new features, `major` only for breaking changes (rare during alpha — confirm with me first).
    - Write the changeset summary in user-facing language (what changed, why it matters), not internal jargon — this becomes the changelog entry.
    - Commit the generated `.changeset/*.md` file with the rest of your change.
    - Skip a changeset ONLY for changes that don't affect any published package: docs-only edits outside packages, CI/tooling, internal scripts, tests-only changes. When in doubt, add one.
14. **Commit messages MUST follow Conventional Commits.** Format: `type(scope): subject`. See Phase 4 for the full spec. The husky `commit-msg` hook will reject malformed messages — fix the message, do not bypass the hook.
15. **Husky hooks are guardrails, not obstacles.** Pre-commit, commit-msg, and pre-push hooks may run lint, type-check, format, and commit-message validation. If a hook fails because of a _pre-existing_ repo issue unrelated to your change, you may proceed only after flagging it to me; if it fails because of _your_ change, fix the underlying problem. NEVER use `--no-verify`, `HUSKY=0`, `--no-gpg-sign`, or any other bypass flag unless I explicitly ask for it.

### MUST NOT

1. Do NOT guess Nextly APIs — always check `nextly` source code.
2. Do NOT reference integration projects as patterns to follow — they may be outdated.
3. Do NOT skip competitor research, brainstorming, or planning gates.
4. Do NOT push code that fails build or lint.
5. Do NOT work on multiple sub-tasks simultaneously.
6. Do NOT make assumptions about unclear requirements — ask me.
7. Do NOT proceed past a gate without completing its requirements.
8. Do NOT attribute Claude in any commit or PR:
   - No `Co-Authored-By: Claude ...` trailers in commit messages.
   - No "🤖 Generated with Claude Code" lines in commit bodies or PR descriptions.
   - No "Claude" or "Claude Code" mentions in commit prose.
   - This applies to squash-merge commit messages as well — strip the footer before merging.
9. Do NOT bypass husky hooks (no `--no-verify`, no `HUSKY=0`, no disabling hooks in config). Fix the underlying issue or flag pre-existing failures.
10. Do NOT introduce new lint errors, type errors, test failures, or warnings — even if the base branch already has some.
11. Do NOT skip the changeset for any user-facing change to a published package. A missing changeset blocks release.
12. Do NOT manually edit version numbers in `package.json`, `CHANGELOG.md`, or any package's published version field. Versioning is owned by Changesets — let `changeset version` do it during release.

---

## Execution Workflow

Follow these phases in strict order. Each gate MUST be completed before proceeding to the next phase. Do NOT skip or combine phases.

### Phase 1: Understand

1. Read the task file specified above.
2. Read the relevant areas of `nextly` codebase to understand current state.
3. Research how competitors handle this — check Payload CMS, Strapi, WordPress/ACF, Directus, and Sanity. Summarize what they do well and what we can do better.
4. Ask me clarifying questions if anything is unclear. Use the question structure defined in MUST rule #12 — plain-English context, options with plain-English pros/cons and concrete examples, honest recommendation, and a clear "what I need from you" line. Do not condense or skip parts; that structure applies to every question, big or small.

**⛔ GATE: Do NOT proceed until you fully understand the requirements and I've answered any questions.**

### Phase 2: Design & Plan

1. Use `/superpowers:brainstorming` to explore approaches, propose 2-3 options with trade-offs, and get my approval on a design.
2. If the task involves UI, use the `frontend-design` skill to design the interface.
3. Once design is approved, use `/superpowers:writing-plans` to create a detailed implementation plan with sub-tasks.
4. Present the sub-task breakdown to me for approval before starting.

**⛔ GATE: Do NOT write any code until I've approved both the design and the plan.**

### Phase 3: Implement (repeat per sub-task)

For each sub-task in the approved plan:

1. Confirm or set the active branch:

   **Plan-driven local mode (OpenAPI work, current default):** stay on the feature branch. NO sub-task branch is created.

   ```
   git checkout feat/openapi-swagger-support
   git status   # verify clean working tree before starting
   ```

   The `feat/openapi-swagger-support` branch was created off `main` at the start of this work and accumulates all OpenAPI tasks as direct commits until the full feature is ready to integrate. Local-only — do NOT push during Phase 1 task execution.

   **Generic mode (non-OpenAPI work):** branch off `main` (this repo has no `dev` branch):

   ```
   git checkout main && git pull origin main
   git checkout -b task-{N}/subtask-{ID}-{short-description}
   ```

   If unclear which mode applies, default to plan-driven if the change touches OpenAPI work; otherwise ask.

2. Use Context7 to fetch latest docs for any libraries you'll use.
3. Use `/superpowers:test-driven-development` for any logic-heavy code — write failing test first, then implement, then refactor.
4. Use `frontend-design` skill for any UI components or pages.
5. Use Playwright MCP plugin to visually verify any UI-facing changes.

**⛔ GATE: Before committing, confirm:**

- [ ] All available checks pass (discover via `package.json`: build, lint, test, check, type-check)
- [ ] No NEW lint errors, type errors, test failures, or warnings introduced (pre-existing ones are acceptable but must be flagged in the PR description)
- [ ] Husky hooks pass without bypass flags
- [ ] Changeset added (`pnpm changeset`) if the change affects any published package — see MUST rule #13
- [ ] UI changes verified visually via Playwright
- [ ] Code does only what the sub-task requires — nothing more

### Phase 4: Review & Merge (repeat per sub-task)

1. **Add a changeset** (skip ONLY for non-package changes — docs outside packages, CI, tooling, tests-only):

   ```
   pnpm changeset
   ```

   - Select the affected packages.
   - Pick bump: `patch` (fix / internal), `minor` (feature), `major` (breaking — confirm with me first; we're in `0.0.x-alpha.x` so breaking changes are still expected, but I want to know).
   - Write the summary in user-facing language — it becomes the changelog entry.
   - Stage the generated `.changeset/*.md` file alongside your code changes.

2. **Commit using Conventional Commits.** The husky `commit-msg` hook enforces this — write it correctly the first time, do not bypass.

   **Format:** `type(scope): subject`
   - **Subject** lower-case, imperative ("add X", not "added X" or "adds X"), no trailing period, ≤ 72 chars.
   - **Scope** is the affected package or area (e.g. `schema-builder`, `runtime`, `cli`, `admin-ui`, `docs`). Use the package name without the `@revnixhq/` prefix.
   - **Body** (optional, separated by blank line) explains the _why_, wraps at ~80 chars.
   - **Footer** for breaking changes: `BREAKING CHANGE: <description>` (also bump the changeset to `major`).

   **Allowed types:**

   ```
   feat(scope):     new user-facing feature
   fix(scope):      bug fix
   chore(scope):    tooling, deps, build config (no user-visible change)
   docs(scope):     documentation only
   refactor(scope): code change that is neither a feat nor a fix
   test(scope):     adding or updating tests
   perf(scope):     performance improvement
   build(scope):    build system or external dependency changes
   ci(scope):       CI configuration
   style(scope):    formatting, whitespace (no code change)
   revert(scope):   reverts a previous commit
   ```

   **Examples:**

   ```
   feat(schema-builder): add unique constraint toggle to text fields
   fix(runtime): handle null author in blog post hydration
   chore(deps): bump drizzle-orm to 0.44.x
   ```

3. **Commit. Push/PR depends on mode:**

   **Plan-driven local mode (OpenAPI work, current default):** commit directly to the feature branch. NO push, NO PR.

   ```
   # Conventional Commit message exactly as specified in the task section of the plan.
   git commit -m "feat(openapi): <subject from task>"
   git log --oneline -1   # verify the commit landed
   ```

   The integration PR (`feat/openapi-swagger-support` → `main`) is created later, once all Phase 1–3 tasks are complete. See "Plan Completion & Integration" below.

   **Generic mode (non-OpenAPI work):** push and open a PR to `main`.

   ```
   git push -u origin <branch-name>
   gh pr create --base main --title "Task {N} Subtask {ID}: {description}" --body "..."
   ```

   For Generic-mode PRs, the PR body MUST include:
   - Summary of the change (what + why)
   - Test plan (what you ran, what you verified)
   - Changeset confirmation: "Changeset added: yes (patch/minor/major)" or "Changeset skipped: <reason>"
   - Pre-existing check failures, if any, listed explicitly so they aren't confused with regressions
   - Spec/plan reference if applicable: cite the task and spec section being implemented

4. **Review step depends on mode:**

   **Plan-driven local mode (OpenAPI work, current default):** run `/superpowers:requesting-code-review` inline as a self-review of the commit you just made. If issues found, fix in a follow-up commit on the same feature branch (`fix(openapi): <subject>`). No merge step — the commit is already on the feature branch.

   **Generic mode (non-OpenAPI work):** run `/superpowers:requesting-code-review` against the open PR. If issues found → fix, push, re-review. **Do NOT auto-merge** — I merge manually. When I merge:

   ```
   gh pr merge --squash --delete-branch
   ```

   The squash commit message must also follow Conventional Commits (no Claude attribution footer).

5. Return to Phase 3 for the next sub-task.

**⛔ GATE: Do NOT start the next sub-task until the current one is committed, all checks pass, and (in generic mode) the PR is merged.**

### Phase 5: Complete

1. Use `/superpowers:verification-before-completion` — run full build, verify all functionality works end-to-end.
2. Update `tasks-tracker.md` with task status, key decisions, and findings.
3. Document any learnings or issues in `findings/` if applicable.
4. Announce completion with a summary of what was delivered.

---

## Plan Completion & Integration (plan-driven mode only)

After every task in a plan has been committed onto the active feature branch (~25 commits for OpenAPI Phase 1):

1. **Sync the feature branch with `main`** to catch any drift from unrelated merges. Until now the feature branch has been local-only, so this is also the first push to origin:

   ```
   git checkout feat/openapi-swagger-support
   git fetch origin main
   git rebase origin/main
   # resolve any conflicts; never use --skip on commits with real changes
   git push -u origin feat/openapi-swagger-support
   ```

   If you've already pushed in a previous integration cycle (e.g., between phases), use `git push --force-with-lease` after the rebase. Use `--force-with-lease` (not `--force`) so you don't clobber a teammate's push.

2. **Run the full check suite on the rebased feature branch:**

   ```
   pnpm install
   pnpm --filter nextly check-types
   pnpm --filter nextly lint
   pnpm --filter nextly test
   pnpm --filter nextly build
   ```

   Everything must pass cleanly. Pre-existing failures on `main` may stay, but flag them in the integration PR description.

3. **Verify Changesets accumulate correctly:**

   ```
   pnpm release:status
   ```

   Confirm the unreleased changeset entries make sense as a single version bump. The highest bump (`minor` if any task was `minor`) wins.

4. **Open the integration PR** from the feature branch to `main`:

   ```
   gh pr create --base main --head feat/openapi-swagger-support \
     --title "feat(openapi): OpenAPI/Swagger support (Phase 1)" \
     --body "<see integration PR template below>"
   ```

5. **Integration PR body MUST include:**
   - Link to the design spec and plan
   - Summary of all tasks committed (one bullet per task, derived from `git log main..feat/openapi-swagger-support --oneline`)
   - Cumulative changeset list (output of `pnpm release:status`)
   - Confirmation that all 25 task commits passed their full check suite at commit time
   - Test plan: full suite run on the rebased feature branch, e2e smoke test results, Playwright screenshots from T25
   - Any pre-existing failures explicitly noted
   - "Spec deferrals" section listing what was intentionally NOT built (per spec Open Questions §18) so reviewers don't flag them as gaps

6. **Review & merge to `main`.** Wait for explicit approval. Merge style: **merge commit** (NOT squash) for the integration PR — preserves the per-task commit history on `main`.

   ```
   gh pr merge --merge --delete-branch  # standard merge, keeps task history
   ```

   In local-only mode there were no sub-task PRs, so every per-task commit lives directly on the feature branch and is preserved on `main` after the merge. Squashing the integration PR would erase 25 useful Conventional Commits into one giant blob — don't do it.

7. **Subsequent Phase 2 / Phase 3 work** of the OpenAPI feature starts a new feature branch (`feat/openapi-swagger-support-phase-2`) off the newly-merged `main`. The plan-driven mode of this prompt then points at the Phase 2 plan.

---

## Skills & Tools Reference

| Skill / Tool                                       | When to Use                                          | Phase |
| -------------------------------------------------- | ---------------------------------------------------- | ----- |
| `/superpowers:brainstorming`                       | Explore approaches, propose designs, get approval    | 2     |
| `/superpowers:writing-plans`                       | Create implementation plan with sub-tasks            | 2     |
| `/superpowers:test-driven-development`             | Logic-heavy code (validators, utils, adapters, APIs) | 3     |
| `/superpowers:systematic-debugging`                | Any bug, test failure, or unexpected behavior        | 3     |
| `/superpowers:verification-before-completion`      | Before declaring task complete                       | 5     |
| `/superpowers:requesting-code-review`              | After creating each PR                               | 4     |
| `frontend-design`                                  | Any UI work (pages, components, layouts)             | 2, 3  |
| Context7 MCP (`resolve-library-id` → `query-docs`) | Before writing any library code                      | 3     |
| Playwright MCP                                     | Visual verification of UI changes                    | 3     |
| GitHub CLI (`gh`)                                  | Branches, PRs, merging                               | 3, 4  |
| Changesets (`pnpm changeset`)                      | Add a changeset for any user-facing package change   | 4     |
| Husky hooks (auto-run on commit/push)              | Enforce lint, type-check, commit-msg format          | 3, 4  |

---

## Tasks Tracker

Maintain `tasks-tracker.md` in the project root. Update it after completing each task.

Format:

| Task               | Status      | Branch/PR            | Key Decisions             | Findings           |
| ------------------ | ----------- | -------------------- | ------------------------- | ------------------ |
| task-1-short-title | done        | PR #12               | Chose X over Y because... | Found issue with Z |
| task-2-short-title | in-progress | task-2/subtask-1-... | —                         | —                  |

## Findings

Write to `findings/` only when something genuinely useful is discovered:

- Bugs or gotchas in Nextly or dependencies
- Patterns that worked well or poorly
- Ideas for future improvement
- Discrepancies between projects

File naming: `findings/{task-number}-{short-topic}.md`
Example: `findings/task-1-media-field-gotcha.md`

---

## When Things Go Wrong

### Bug or test failure

Use `/superpowers:systematic-debugging`. Investigate root cause FIRST — read logs, trace code, identify the actual problem. Do NOT guess-and-fix.

### Unclear requirements

Stop and ask me. Quote the specific part of the task file that's unclear, then follow the question structure in MUST rule #12 — plain-English context, options with plain-English pros/cons and concrete examples, honest recommendation, and a clear "what I need from you" line.

### Build or lint fails

Fix before committing. Never push broken code. If the failure is unrelated to your changes:

- Confirm it's pre-existing by running the same check on the clean base branch (or check `dev`'s CI status).
- If pre-existing: flag it to me, list it in the PR description, and proceed. Do NOT silently work around it.
- If new (caused by your change): fix it. No exceptions.

### Husky hook failure

- **`commit-msg` hook fails:** your commit message doesn't match Conventional Commits. Re-write the message; do NOT use `--no-verify`.
- **`pre-commit` hook fails (lint/format/type):** if the failure is on files _you_ changed, fix the underlying issue. If it's on files you did not touch (pre-existing), flag it to me and we'll decide together — do NOT bypass.
- **`pre-push` hook fails:** same logic — diagnose first, fix or flag, never bypass.

### Changeset missing or wrong

- Forgot to add one before committing? Run `pnpm changeset`, commit the file as a follow-up commit on the same branch (`chore(changeset): add changeset for <feature>`), push.
- Wrong bump level? Edit the `.changeset/*.md` file directly and commit the fix.
- Unsure if a change needs a changeset? Default to adding one. Better an extra patch entry than a missing release note.

### Task is too large

Break it into smaller sub-tasks using `/superpowers:writing-plans`. Present the breakdown to me for approval. Work on one sub-task at a time.

### Conflict between nextly monorepo and integration project

Follow `nextly`. Always.

### Unsure which branch to base from

Check which branch has the latest commits. If still unclear, ask me.
