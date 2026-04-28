# Security Fix Implementation Prompt

**Task:** `SECURITY_FIXES.md` → **T-NNN** (replace with the specific task ID, e.g. `T-001`)

> **Sibling prompt:** [`task-implementation-prompt-root.md`](task-implementation-prompt-root.md) is for _feature_ work. Use **this** prompt for any task in `SECURITY_FIXES.md`. The two differ in which gates apply (security work skips brainstorm/plan/TDD; the feature prompt requires them).

---

## About this work

Nextly is approaching beta. A multi-round security audit produced [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) (7 Critical + 14 High + 23 Medium + 9 Low findings + 1 accepted-risk + 28 verified positives) and an execution-ready tracker [`SECURITY_FIXES.md`](SECURITY_FIXES.md) with stable task IDs (`T-001` … `T-111`), parallel swimlanes, and verification commands.

These are **hardening tasks**, not feature work. The design is already done. Your job is to implement one task — pick a `T-NNN`, follow the workflow below, ship the PR.

---

## Source of Truth

| Document                                 | Use it for                                                                                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nextly` (this repo)                     | The codebase. Always authoritative for current behavior.                                                                                                    |
| [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) | _Why_ a finding exists. Background, attack scenarios, file/line citations.                                                                                  |
| [`SECURITY_FIXES.md`](SECURITY_FIXES.md) | _What we're doing about it._ Task IDs, files to touch, fix steps, acceptance criteria, verification commands, breaking-change flags, branch/PR conventions. |

If a sibling project (`codexspot`, `mobeen-site`, `21c-v3`, etc.) does something differently, ignore it. Those are integration projects and may be outdated.

---

## Hard Rules

### MUST

1. Read the `T-NNN` block in [`SECURITY_FIXES.md`](SECURITY_FIXES.md) **and** the cross-referenced finding (e.g., `C1`, `H8`) in [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) before touching code.
2. Use `nextly` as the sole reference for current Nextly behavior — read the actual files listed under the task's **Files** entry.
3. Use Context7 MCP plugin **only** when adding a specific library mentioned in the task (e.g., `file-type` for T-006, `re2`/`safe-regex2` for T-017, `dompurify` for T-006). Resolve the library ID first, then query docs with the specific question.
4. Use the relevant superpower skills (see Skills table below). Do **not** invoke `/superpowers:brainstorming`, `/superpowers:writing-plans`, or `/superpowers:test-driven-development` — those are for feature work and the design here is already specified.
5. One `T-NNN` at a time. Finish, verify, commit, PR, merge — then pick the next.
6. All checks pass before commit: `pnpm test && pnpm check-types && pnpm lint && pnpm audit`. Plus any DB-specific integration suite the task touches (`pnpm test:integration:postgres17` etc.).
7. Run the exact verification commands listed in the task's **Verify** block — do not improvise.
8. For tasks tagged 🔥 **BREAKING**: add a changeset entry and a migration note in `docs/migration/<release>.md` before opening the PR.
9. Use the branch / commit / PR conventions from `SECURITY_FIXES.md` (`security/T-NNN-...`, `security(T-NNN): ...`).
10. Visually verify with Playwright MCP **only if the task touches admin UI**. Most security tasks don't.
11. Ask the maintainer when requirements are unclear — quote the specific part of the task and propose options. Especially for tasks listed in `SECURITY_FIXES.md` _Open questions_ (T-003, T-006).

### MUST NOT

1. Do NOT guess Nextly APIs — read the source.
2. Do NOT do competitor research (Payload, Strapi, etc.) for these tasks. The fixes follow well-known security practice; the audit's recommended approach is the design.
3. Do NOT skip Phase 1 reading even when the task looks small. Reading the audit context prevents fixing the symptom and missing the root cause.
4. Do NOT add new test files. Project policy: rely on the existing suite + manual verification per the task. Extending an _existing_ `*.test.ts` with a new case is acceptable only if explicitly noted in the task; ask first if you're unsure.
5. Do NOT push code that fails build, lint, type-check, or `pnpm audit`.
6. Do NOT work on multiple `T-NNN` tasks simultaneously.
7. Do NOT bundle tasks into one PR unless they appear together under "Bundling opportunities" in `SECURITY_FIXES.md`.
8. Do NOT proceed past a phase gate without completing its checklist.
9. Do NOT attribute Claude in any commit or PR:
   - No `Co-Authored-By: Claude ...` trailers.
   - No "🤖 Generated with Claude Code" lines.
   - No "Claude" / "Claude Code" mentions in commit prose or PR descriptions.
   - This applies to squash-merge commit messages — strip the footer before merging.
10. Do NOT silently widen scope. If a task says "rate-limit /auth/login," do not also rate-limit `/auth/refresh` in the same PR — open a separate task.

---

## Execution Workflow

Five phases. Each gate must be cleared before moving on. The phases are intentionally lighter than the feature-work prompt because the design is already done.

The whole workflow runs on a **phase integration branch** model: each phase has its own long-lived branch (`security/phase-1`, `security/phase-2`), task PRs land on that branch, and the phase branch is PR'd to `dev` once all its tasks are in. See _Branching model_ in [`SECURITY_FIXES.md`](SECURITY_FIXES.md) for the full diagram.

### Phase kickoff (first dev only)

Run **once per phase**, before any task work begins. If `security/phase-N` already exists on the remote, skip — you're not the first dev. If it doesn't, you are; do this:

```bash
# Verify dev baseline is green (per phase entry criteria in SECURITY_FIXES.md)
git checkout dev && git pull origin dev
pnpm test && pnpm check-types && pnpm lint
# If any fail, STOP. Revert the offending dev commit before starting the phase.

# Create + push the phase branch
git checkout -b security/phase-N
git push -u origin security/phase-N
```

Then proceed to Phase 1 of the workflow for your specific `T-NNN`.

### Phase finalization (last dev to push a task commit)

When the **last** Phase-N task commit lands on `security/phase-N` (i.e., _Pending_ + _Claimed_ hit zero), that dev (or whoever is on point) opens the single phase → `dev` PR. One-time action per phase.

```bash
git checkout security/phase-N && git pull origin security/phase-N

# Bring in any unrelated dev advances
git fetch origin
git rebase origin/dev
# Resolve conflicts if any. Keep history linear.

# Full verification on the integrated phase branch
pnpm test && pnpm check-types && pnpm lint && pnpm audit

git push --force-with-lease

gh pr create --base dev \
  --title "Security Phase N: <theme> (T-NNN through T-MMM)" \
  --body "<phase summary, all task IDs, breaking-change rollup, link to migration guide>"

# Merge with --merge (NOT squash) so per-task commits stay bisectable
gh pr merge --merge --delete-branch
```

After merge: confirm Phase N exit criteria in SECURITY_FIXES.md are met, update the Status overview block (move counts to next phase if applicable), and announce the phase release.

### Phase 1: Understand (~5–15 min)

1. Read the `T-NNN` block in [`SECURITY_FIXES.md`](SECURITY_FIXES.md) end-to-end — including **Verify**, **Rollout note**, and **Blocked by / Blocks**.
2. Read the cross-referenced finding in [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) for the _why_.
3. Read the actual files listed under **Files** in the task. Trace the code paths affected.
4. Verify any **Blocked by** task is already merged (e.g., T-015 / T-016 require T-005 first).
5. If the task is in `SECURITY_FIXES.md` _Open questions_ (T-003, T-006, T-009), confirm the maintainer's decision before coding.

**⛔ GATE:** Do NOT proceed until you can describe in one sentence what the fix does and which existing tests will exercise it.

### Phase 2: Setup (~2 min)

> **First task of a phase?** Before doing this Phase 2, see [Phase kickoff](#phase-kickoff-first-dev-only) below — you need to create `security/phase-N` from `dev` once before any task work starts.

There is no per-task branch in this model. Tasks are commits on the phase branch.

1. Pull the latest phase branch:
   ```bash
   git fetch origin
   git checkout security/phase-N && git pull origin security/phase-N
   # Replace N with 1 or 2 depending on which phase your T-NNN belongs to.
   ```
2. **Claim the task in `SECURITY_FIXES.md`:**
   - Edit the task's `**Status:**` line (or row, for Phase 2 table) from `pending` → `claimed: <your-name>`.
   - In the _Status overview_ block at the top of the doc, decrement _Pending_ and increment _Claimed_ for the relevant phase. Bump the **Last updated** date.
   - Commit and push this claim immediately so other devs see it before they start the same task:
     ```bash
     git add SECURITY_FIXES.md
     git commit -m "chore(security): claim T-NNN"
     git push origin security/phase-N
     ```
     (You can skip the separate claim commit if you'll finish the task in this same session — fold the status updates into the implementation commit instead. Use the separate claim only when there's any chance another dev might race you.)
3. If adding a library, fetch its current docs via Context7 (`resolve-library-id` → `query-docs`) before writing imports.

**⛔ GATE:** Do NOT skip step 2 if you might leave the task overnight — claiming prevents two devs from racing on the same task. Do NOT skip the docs fetch when adding a library — the audit specifies versions/APIs that may have shifted. Do NOT create a per-task branch — work directly on `security/phase-N`.

### Phase 3: Implement

1. Apply the fix as specified in the task's **Fix** block. Do only what the task requires — nothing more.
2. If the change touches admin UI, use the `frontend-design` skill for any new components and verify visually with Playwright MCP.
3. If something unexpected breaks (a test that wasn't related to your change fails), use `/superpowers:systematic-debugging`. Investigate root cause; do not guess-and-patch.
4. Run the task's **Verify** commands locally. Capture the manual-check evidence (curl output, screenshots if UI) for the PR description.

**⛔ GATE — before committing, confirm:**

- [ ] Task's **Verify** commands all pass (paste output into a scratch file for the PR description).
- [ ] `pnpm test` green.
- [ ] `pnpm check-types` green.
- [ ] `pnpm lint` green.
- [ ] `pnpm audit` clean (no new advisories).
- [ ] If DB-related: relevant `pnpm test:integration:*` green.
- [ ] If 🔥 BREAKING: changeset entry created (`pnpm changeset`) and migration note drafted.
- [ ] If UI: Playwright manual smoke complete; screenshots ready for PR.
- [ ] No new test files added (project policy).
- [ ] Diff scope matches the task — no incidental refactors.

### Phase 4: Commit & Push

There is no per-task PR. Each task is a commit on the phase branch.

1. Update the task's `**Status:**` to `done (<short-sha-pending>)` in `SECURITY_FIXES.md`. Increment _Done_ and decrement _Claimed_ (or _Pending_ if you skipped the claim step) in the _Status overview_ block. Bump the **Last updated** date. (You'll backfill the actual sha on the next step using `git commit --amend` after the commit, OR simply use a placeholder like `<short-sha>` and trust the commit subject for traceability — pick one and be consistent.)
2. Commit:
   ```bash
   git add .
   git commit -m "security(T-NNN): <Title from SECURITY_FIXES.md>"
   ```
   For bundled tasks (e.g., T-001 + T-007 transport defaults): one commit covering both, subject `security(T-001+T-007): <theme title>`.
3. (Optional but recommended) backfill the sha into the Status line:
   ```bash
   SHA=$(git log -1 --format=%h)
   sed -i "s/done (<short-sha-pending>)/done ($SHA)/" SECURITY_FIXES.md
   git add SECURITY_FIXES.md
   git commit --amend --no-edit
   ```
4. Push to the phase branch:
   ```bash
   git push origin security/phase-N
   ```
5. **Strip any auto-added Claude attribution** from the commit message before pushing (use `git commit --amend` if needed).

**Code review:** for solo or small-team work, the maintainer reviews commits inline as they land on the phase branch (`git log security/phase-N` or local checkout) and signals approval informally. The **formal review happens at Phase finalization** when the phase PR opens — at that point use `/superpowers:requesting-code-review`. If a particular task is high-risk and you want focused review now, ping the maintainer to walk that single commit before continuing.

**⛔ GATE:** Do NOT start the next `T-NNN` until this one's commit is pushed and verification (Phase 3 gate) passed. The phase branch is shared — broken commits affect everyone working on the phase.

### Phase 5: Complete

1. Verify the phase branch is still green after your push:
   ```bash
   git checkout security/phase-N && git pull origin security/phase-N
   pnpm test && pnpm check-types && pnpm lint && pnpm audit
   ```
   If anything went red because of your commit, fix it on a follow-up commit (`fix(security): ...`) — do NOT leave the phase branch broken.
2. Status line should already say `done (<sha>)` from Phase 4. Confirm the _Status overview_ counts match reality (Pending + Claimed + Done = total tasks per phase).
3. If something genuinely surprising came up during the fix (a related vuln, a wrong assumption in the audit, a brittle pattern), write it to `findings/T-NNN-<short-topic>.md`. Do not write filler — only note things future implementers would benefit from knowing.
4. Announce completion in your team channel: `T-NNN done. Commit: <sha> on security/phase-N. Audit ref <C/H/M-NN>. <Brief outcome>.`
5. **If this was the last task in the phase** (the _Pending_ + _Claimed_ counts hit zero): proceed to [Phase finalization](#phase-finalization-last-dev-to-push-a-task-commit). Otherwise, return to Phase 1 of the workflow for the next `T-NNN`.

---

## Skills & Tools Reference

| Skill / Tool                                       | When to use                                                   | Phase |
| -------------------------------------------------- | ------------------------------------------------------------- | ----- |
| `/superpowers:systematic-debugging`                | Any unexpected test failure or behavior change after your fix | 3     |
| `/superpowers:requesting-code-review`              | After opening each PR                                         | 4     |
| `/superpowers:verification-before-completion`      | Before declaring task complete                                | 5     |
| `frontend-design`                                  | Only for tasks that touch admin UI                            | 3     |
| Context7 MCP (`resolve-library-id` → `query-docs`) | Only when adding a library specified in the task              | 2     |
| Playwright MCP                                     | Only for tasks that touch admin UI                            | 3     |
| GitHub CLI (`gh`)                                  | Branch, PR, merge                                             | 3, 4  |

**Skills NOT used for security tasks (and why):**

| Skill                                  | Why skipped                                                 |
| -------------------------------------- | ----------------------------------------------------------- |
| `/superpowers:brainstorming`           | Design is already done in the audit; no exploration needed. |
| `/superpowers:writing-plans`           | Each `T-NNN` already _is_ the plan.                         |
| `/superpowers:test-driven-development` | Project policy forbids new test files.                      |

---

## Tracking & status

Status lives **inside [`SECURITY_FIXES.md`](SECURITY_FIXES.md)** — there is no separate `tasks-tracker.md` to keep in sync. Two places to touch when a task transitions:

1. The **Status overview** block at the top of the doc (per-phase counts: Done / Claimed / Blocked / Pending).
2. The task's `**Status:**` line (Phase 1 task blocks) or the `Status` column (Phase 2 table row).

Both must be updated together — otherwise the rollup at the top drifts from per-task reality. The prompt's Phase 2 / Phase 4 / Phase 5 gates enforce these updates at claim / done transitions.

**Status values per task:**

- `pending` — not started
- `claimed: <name>` — someone owns it but hasn't pushed an implementation commit yet
- `done (<short-sha>)` — implementation commit landed on `security/phase-N`
- `blocked: <reason>` — waiting on a dependency commit or maintainer decision

(The previous `in-review (#PR)` value is gone — there are no per-task PRs in this model. Review happens at the phase PR.)

**Phase-level status** (tracked informally at the top of `SECURITY_FIXES.md` or in a team channel):

- `kickoff` — branch created, tasks not yet started
- `in-progress` — task commits landing
- `in-review (#PR)` — phase PR open, awaiting review
- `released (#PR)` — phase PR merged to `dev`, beta tag cut

**If two devs work in parallel:** both pull `security/phase-N` and check the _Status overview_ before starting. First to push `chore(security): claim T-NNN` wins; second pulls, sees the claim, picks the next `pending`.

**If the file drifts** (status says `done (sha)` but the sha doesn't exist, or claims that never landed an implementation):

```bash
# Quick reality-check commands
git log security/phase-N --oneline --grep="security(T-"   # all task commits on phase branch
git log security/phase-N --oneline --grep="chore(security): claim"  # all claims
gh pr list --search "Security Phase"                       # phase PRs (open or merged)
```

Compare against the _Status overview_ table; correct any drift in a single follow-up commit on the phase branch.

---

## Findings

Write to `findings/` only when something genuinely useful surfaced **during implementation** that wasn't in the audit:

- A related vuln you found while reading the surrounding code (open a new audit finding too).
- An assumption in the audit that turned out to be wrong.
- A pattern that's brittle and likely to regress (e.g., a copy-pasted helper that needs centralizing).
- A subtle interaction between fixes (e.g., T-005 and T-016 ordering nuance).

File naming: `findings/T-NNN-<short-topic>.md`
Example: `findings/T-005-xff-helper-placement.md`

Do **not** write a finding just to summarize what the task did — that's what the PR description is for.

---

## When Things Go Wrong

### A test failed that's unrelated to my change

Use `/superpowers:systematic-debugging` to find the root cause. If the failure is genuinely pre-existing on `dev`, flag it to the maintainer **before** working around it. Do not push code that requires a workaround for someone else's bug.

### My fix breaks an existing test

Two cases:

1. The test encoded the _insecure_ behavior that we're fixing (e.g., a test asserting that S3 uploads default to `public-read`). Update the test to assert the new behavior; note this in the PR description.
2. The test exercises something genuinely unrelated. Use `/superpowers:systematic-debugging` — your fix may have a wider blast radius than the audit assumed. Re-read the task's **Files** list; if the fix surface is bigger than expected, pause and ask the maintainer whether to extend or split the task.

### Unclear requirement / open question

Stop. Quote the unclear sentence from the task. Propose 2 options with trade-offs. Especially watch for the items listed in `SECURITY_FIXES.md` _Open questions_ (T-003, T-006, etc.) — those should be answered before kickoff, not improvised mid-task.

### Build / lint / typecheck fails

Fix before committing. Never push broken code. If the failure is unrelated to your changes (e.g., a `dev`-baseline regression), flag it before working around it.

### `pnpm audit` reports a new advisory after a library bump

Do not silence it. Either pin to a non-vulnerable version, replace the dependency, or open a separate `T-NNN` for the upgrade and pause the current task.

### Task is bigger than estimated

The audit categorized tasks as S/M/L. If you're 2× over the estimate and not done:

- For S → M overrun: keep going.
- For M → L overrun: pause, post a status update with what's left, and ask whether to split the task.
- For L overrun: split is almost always the right call. Use `/superpowers:writing-plans` (the _one_ exception to the no-plan rule for security work, since you're now creating sub-tasks).

### Conflict between this prompt and `task-implementation-prompt-root.md`

Use **this one** for any `T-NNN` task. The root prompt is for feature work and has different gates; mixing them produces wasted brainstorm/plan cycles for fixes that don't need them.

### Conflict between `nextly` source and an integration project

Follow `nextly`. Always.
