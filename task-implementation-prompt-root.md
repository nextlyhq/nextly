# Task Implementation Prompt

## **Task:** `tasks/nextly-dev-tasks/20-schema-architecture-finalized-plan.md`

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
8. Ask me when requirements are unclear. Quote the specific part and ask — don't assume.
9. Verify visually with Playwright MCP plugin for any UI-facing changes.
10. Document genuine findings, learnings, and issues in the `findings/` and `plans` folders.
11. When presenting approaches, asking questions, or discussing anything — be explanatory with examples so I can understand the reasoning, trade-offs, and decisions clearly.

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

---

## Execution Workflow

Follow these phases in strict order. Each gate MUST be completed before proceeding to the next phase. Do NOT skip or combine phases.

### Phase 1: Understand

1. Read the task file specified above.
2. Read the relevant areas of `nextly` codebase to understand current state.
3. Research how competitors handle this — check Payload CMS, Strapi, WordPress/ACF, Directus, and Sanity. Summarize what they do well and what we can do better.
4. Ask me clarifying questions if anything is unclear. Provide options with your recommendations so I can choose quickly.

**⛔ GATE: Do NOT proceed until you fully understand the requirements and I've answered any questions.**

### Phase 2: Design & Plan

1. Use `/superpowers:brainstorming` to explore approaches, propose 2-3 options with trade-offs, and get my approval on a design.
2. If the task involves UI, use the `frontend-design` skill to design the interface.
3. Once design is approved, use `/superpowers:writing-plans` to create a detailed implementation plan with sub-tasks.
4. Present the sub-task breakdown to me for approval before starting.

**⛔ GATE: Do NOT write any code until I've approved both the design and the plan.**

### Phase 3: Implement (repeat per sub-task)

For each sub-task in the approved plan:

1. Create a feature branch from the latest branch (default: `dev`):
   ```
   git checkout dev && git pull origin dev
   git checkout -b task-{N}/subtask-{ID}-{short-description}
   ```
   If `dev` doesn't exist, check which branch has the latest commits. If unclear, ask me.
2. Use Context7 to fetch latest docs for any libraries you'll use.
3. Use `/superpowers:test-driven-development` for any logic-heavy code — write failing test first, then implement, then refactor.
4. Use `frontend-design` skill for any UI components or pages.
5. Use Playwright MCP plugin to visually verify any UI-facing changes.

**⛔ GATE: Before committing, confirm:**

- [ ] All available checks pass (discover via `package.json`: build, lint, test, check)
- [ ] UI changes verified visually via Playwright
- [ ] Code does only what the sub-task requires — nothing more

### Phase 4: Review & Merge (repeat per sub-task)

1. Commit using conventional commits:
   ```
   feat(scope): short description
   fix(scope): short description
   chore(scope): short description
   ```
2. Push and create a PR targeting `dev`:
   ```
   git push -u origin <branch-name>
   gh pr create --base dev --title "Task {N} Subtask {ID}: {description}" --body "..."
   ```
3. Use `/superpowers:requesting-code-review` to review the PR.
4. If issues found → fix, push, re-review. If approved → merge:
   ```
   gh pr merge --squash --delete-branch
   ```
5. Return to Phase 3 for the next sub-task.

**⛔ GATE: Do NOT start the next sub-task until the current one is merged.**

### Phase 5: Complete

1. Use `/superpowers:verification-before-completion` — run full build, verify all functionality works end-to-end.
2. Update `tasks-tracker.md` with task status, key decisions, and findings.
3. Document any learnings or issues in `findings/` if applicable.
4. Announce completion with a summary of what was delivered.

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

Stop and ask me. Quote the specific part of the task file that's unclear. Provide options with your recommendation so I can decide quickly.

### Build or lint fails

Fix before committing. Never push broken code. If the failure is unrelated to your changes, flag it to me before working around it.

### Task is too large

Break it into smaller sub-tasks using `/superpowers:writing-plans`. Present the breakdown to me for approval. Work on one sub-task at a time.

### Conflict between nextly monorepo and integration project

Follow `nextly`. Always.

### Unsure which branch to base from

Check which branch has the latest commits. If still unclear, ask me.
