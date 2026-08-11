# RESUME PROMPT — paste this into a fresh session

Continue the Nextly admin theme work. **The theme has been chosen and applied; what remains is
verifying it in a browser and shipping it as one PR.** I have no open PRs.

## Step 0 — read before touching anything

1. **`apps/playground/src/theme-lab/HANDOFF-2026-08-11-admin-theme.md` IN FULL.** It is the session
   map. §6 (hard-won knowledge) and §8 (what is left) are the parts that cost real time.
2. `apps/playground/src/theme-lab/AUDIT-task-08.md` — the audit report; the record of WHY the theme
   changed, including the Payload/Strapi answer and the honest limitations of the contrast metric.
3. `apps/playground/src/theme-lab/TASK-neutral-ramp.md` — the deferred follow-up, scoped and ready.

## Step 1 — orient

```
cd /Users/mobeen/Work/Products/nextly-integrations/nextly-worktrees/theme-variations
git fetch origin && git status && git log --oneline -3
git ls-remote --heads origin explore/admin-theme-variations
gh pr list --repo nextlyhq/nextly --state open --json number,headRefName -q '.[] | "#\(.number) \(.headRefName)"'
```

Expect: branch `explore/admin-theme-variations`, local head **`43c100fa7`**, remote possibly behind
at `c1165e003`. **No PR of mine exists.** `origin/main` moves several times an hour.

**Work ONLY in `nextly-worktrees/theme-variations`.** Never in `.../nextly-integrations/nextly` —
that is the shared checkout. The previous session was worktree-isolated and git operations targeting
anything else were refused.

**After any merge of main: run `pnpm install` BEFORE trusting a build.** A stale `node_modules`
produces failures that name someone else's file (this happened with `@radix-ui/react-slider`).

## Step 2 — the work, in priority order

### 1. Push the theme commit (IMMEDIATE)

`43c100fa7` ("feat(ui): adopt the neutral palette as the admin theme") is LOCAL ONLY.

```
git push origin explore/admin-theme-variations
git ls-remote --heads origin explore/admin-theme-variations   # verify the remote MOVED
```

The pre-push hook runs a full build. Verify the remote actually moved — a background push can report
success while the hook rejected it.

### 2. Verify the new theme in a browser — the founder asked for this specifically

```
pnpm --filter @nextlyhq/ui build && pnpm --filter @nextlyhq/admin build
pnpm dev:app        # from the worktree root, serves :3000
```

In the browser, clear `localStorage["nextly-theme-lab"]` first so you see the SHIPPED theme rather
than a lab override. Then on `/admin` and `/admin/collections/posts`, in BOTH light and dark:

- **checkbox borders** — the founder's explicit concern; uses `border-input`, corrected to 3.4:1
- **the table search field edge** — same token
- row dividers and card borders — `border-subtle` is intentionally near-invisible (~1.1:1); that is
  correct for a divider, NOT a defect
- the selected sidebar row — should read as emphasised by both its fill AND its ink

Report anything that looks wrong with a measurement, not an impression.

### 3. Open ONE PR to `main`

Founder decision: one PR carries everything. Contents:

- `packages/ui/src/styles/theme.css` — adopted palette, contrast margins, duplicate-token cleanup
- `packages/admin/src/components/layout/sidebar/{index,DualSidebar}.tsx` — the nav-row token fix
- `apps/playground/**` — the lab, audit and docs (unpublished; the audit report is the record of why
  the theme changed and is worth carrying)

**ONE changeset covering EVERY package in the fixed group at `patch`, generated in node from
`.changeset/config.json` — never hand-typed.** PR body should state: what changed and why, the
before/after contrast numbers, the pre-existing admin test baseline (27 failed / 1464 passed —
verified identical with and without these changes), and that the playground is unpublished.

Then post `@codex please review this PR` and **set a 15-minute watcher** on it. None is running.

### 4. After the PR merges

- **Give the UI lane the all-clear** (socket `6711`) — they are holding
  `packages/ui/src/styles/contrast/` frozen at this lane's request and are waiting to consolidate it
  onto their new colour engine. The audit is finished; the freeze can lift.
- Start `TASK-neutral-ramp.md` — highest-value structural improvement found, deliberately deferred
  until the palette was chosen so the ramp derives from the shipped one.

## Step 3 — talk to the other sessions

`ListAgents`, then `SendMessage`. Confirmed lanes and boundaries are in HANDOFF §7. The **styling /
blocks lane** (socket `82376`) has been the most valuable correspondent — it verifies claims rather
than relaying them. **`gh pr list` is the only reliable claim check**; worktrees and commit messages
are not.

## Hard rules

Never commit to `main`. Never `--no-verify`. **No AI attribution** in commits or PR bodies.
Conventional Commits, lowercase imperative subject ≤72 chars, via `git commit -F <file>`. ONE
changeset per PR covering all fixed-group packages at `patch`; none for docs/CI/test-only. No
`as any` / `@ts-expect-error` / eslint-disable — fix the cause with real types. Every change carries
a what/why comment describing the CODE only, never a task, PR or review finding. Drizzle only, no
raw SQL. `NextlyError` in `packages/nextly/**`. Never bare `git stash` (shared stack). **Never use
the words "tweakcn" or any preset brand name in user-facing text — there is no theme system, only
THE admin theme.**

**Do not merge.** The gate is CI fully green AND zero unresolved review threads. Report readiness to
the founder instead.

## The judgements that settle most questions here

- **Measure the artifact the product actually loads.** The lab MIRRORS the shipped theme, so a fix
  applied to the mirror looks identical to a fix applied to the product — every number improved,
  every test passed, and the admin was untouched. That happened once already.
- **An import is not proof of a read**, and **zero is the same answer as "read nothing"**. Run a
  positive control before trusting a clean result.
- **A green assertion tells you the pair it NAMES is fine; it says nothing about the pair the
  product RENDERS.** That is how a nav-row defect survived for months with a passing suite.
- **A failure count is a property of (palette × contrast source), not of the palette.** Counts are
  stamped with the contrast-source revision for exactly this reason.
- **A "do not edit by hand" banner is about durability, not permission.** Layer over generated
  output and assert the layer is separate.
- **Passing and passing-by-enough are different properties.** Solve to a margin, never to the gate.
- **Verify a pre-existing failure baseline by measuring it both ways** before attributing anything to
  your own change.
