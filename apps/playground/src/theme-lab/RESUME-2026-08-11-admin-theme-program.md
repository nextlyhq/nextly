# RESUME PROMPT — paste this into a fresh session

Continue the Nextly admin theme program. **The theme is shipped and merged.
What remains is one open PR in review, two queued items, and a standing
watch.**

## Step 0 — read first

`apps/playground/src/theme-lab/HANDOFF-2026-08-11-admin-theme-program.md` **in
full**. §3 is the open work, §5 is the CI hazards that will otherwise cost you
an hour, §6 is the judgements that settle most questions in this lane.

Then skim `AUDIT-task-08.md` only if you need the theme-selection history.

## Step 1 — orient with REAL values

```
cd /Users/mobeen/Work/Products/nextly-integrations/nextly-worktrees/theme-variations
git fetch origin && git status --short && git log --oneline -3
git ls-remote --heads origin fix/dashboard-capture-evidence
gh pr view 674 --repo nextlyhq/nextly --json headRefOid,mergeable,mergeStateStatus,state
gh pr checks 674 --repo nextlyhq/nextly --json name,state -q '.[] | "\(.state)\t\(.name)"'
```

Expect head `b43e25c31`, remote identical. `origin/main` moves several times an
hour.

Count unresolved threads with the GraphQL `reviewThreads` query — **never
infer from CI colour or review timestamps**:

```
gh api graphql -f query='query { repository(owner:"nextlyhq",name:"nextly"){ pullRequest(number:674){
  reviewThreads(first:100){ nodes { id isResolved path line comments(first:1){ nodes { databaseId body } } } } } } }'
```

**Work ONLY in `nextly-worktrees/theme-variations`.** Never in
`.../nextly-integrations/nextly` — another session switched that checkout off a
branch mid-command today.

## Step 2 — the work, in priority order

### 1. #674 to green

Zero unresolved as of writing. Watch it, work any new finding through the loop
in Step 3, report readiness. **Merge only if CI is fully green AND unresolved
is zero** — the founder granted this conditionally and both halves must hold.
A Codex _usage-limit_ reply is a fourth verdict state next to clean / findings
/ error, and a check that only looks for findings reads it as a pass. Verify
the verdict; do not infer it.

### 2. `--nx-font-mono` — its own PR, with a changeset

Declared nowhere; `theme.css` has only Tailwind's `--font-mono` (~line 524), so
the API playground's CodeMirror editor falls back to generic monospace.
Declare `--nx-font-mono` with the other shell tokens, map `--font-mono` to it
in `@theme inline`, consume the `--nx-` token at the call site. **Spans
`packages/ui` + `packages/admin`, both published.** Reaching past the token to
the global is the bypass the admin contract exists to prevent.

### 3. `SidebarInset` — hygiene

`packages/admin/src/components/layout/sidebar/index.tsx:289`. Exported, never
rendered, carries a `<main>`. Prefer changing its element to a `<div>` over
deleting it: the `<main>` is a shadcn default and the admin already renders its
own landmark at `DashboardLayout.tsx:105`.

### 4. Raise, do not start

**The plugin identity contract.** `PluginDefinition` has no `displayName`; the
human label lives at optional `admin.appearance.label`. Only form-builder sets
it. This blocks any plugin directory and gets expensive once one ships. It was
found by measurement, not from the ruled-out task file — put it to the founder
rather than starting it.

### DO NOT work from `tasks/admin-ui-tasks/09-general-ui-tweaks-improvements.md`

The founder ruled: _"that file is not ready yet. ignore the tasks in that
file."_ That covers tabs, the dimmed search field, plugin token compliance, the
sidebar border, the sidebar logo, the table audit, plugin pages, Create Form,
and the multilingual/versioning revamps.

## Step 3 — the loop for every finding

Read in full → **MEASURE the claim against real source** → fix the cause not
the symptom → add a test → **stub-verify it** (disable the mechanism, confirm
THAT test fails) → typecheck, lint, run affected suites → merge `origin/main` →
push → **verify with `git ls-remote`** → reply in the thread → resolve via
GraphQL → post `@codex please review this PR`.

**Measuring means measuring.** Two findings this program were **refuted** by
driving a real browser: the theme switcher was claimed dead (`setTheme` a
no-op) and was fine — 20 of 20 admin roots flipped. Do not fix a claim you
have not reproduced.

**On stub-verification:** if a stub does not falsify, first check the stub
landed and disables an input the code reads. Several times a non-falsifying
stub was a bad probe rather than an inadequate test.

**Commit before stub-verifying.** `git checkout -- file` restores to the last
COMMIT and has twice reverted a real fix along with a stub.

## Step 4 — talk to the other sessions

`ListAgents` (sockets go stale on restart), then `SendMessage`. Ask for a
**delete-or-regenerate list**, not just an edit list. State your own holdings
and intentions as **separate** lists.

Lanes as of writing: UI components (#673 artifact gate, #656 layering, colour
picker), page-builder renderer (`blocks-react`/`blocks-engine`), preview/auth
(#601). None touches `packages/ui/src/styles/**` or `apps/playground/**`.

One queued cross-lane item: another lane will add `@types/node` to
`packages/ui` to close the zero-typechecked-tests gap. **It must be scoped to a
test-only tsconfig**, or Node globals go ambient across `src/**` and a
published browser module reaching `process.env` typechecks cleanly. Agreed
with them; scheduled after their colour picker.

## Hard rules

Never commit to `main`. Never `--no-verify`. No AI attribution. Conventional
Commits, lowercase imperative ≤72 chars, via `git commit -F`. ONE changeset per
PR at `patch` covering every package in the fixed group, generated in node from
`.changeset/config.json`, never hand-typed; playground and test-only changes
get none. No `as any` / `@ts-expect-error` / eslint-disable — type a `.mjs`
helper with a sibling `.d.mts`. Comments describe the CODE, never tasks,
reviews or conversations — there are tests for this, and it is the single most
recurring finding against this lane. After merging main, `pnpm install` before
trusting a build; a stale `dist` produces typecheck errors in _other_ packages
that look like yours. Never bare `git stash`.

## Before blaming your diff for a red

- `dist/chunk-<hash>.mjs` / `Failed to resolve entry for package "X"` /
  `Cannot find package 'nextly/…'` → fixed by #669. Grep all three.
- `PUSHSCHEMA_FAILED` / `DROP TABLE single_*` → fixed by #649.
- `super-linearly` in `blocks-engine` → wall-clock flake, task 188.

## The judgements you will need most

- **Measure the artifact the product renders**, not the one convenient to
  measure.
- **A guard that shares state with what it inspects will eventually certify
  its own output.**
- **Ask whether the check runs at all in the layer where its property lives.**
  `packages/ui` typechecks zero test files, so a type assertion there cannot
  fail.
- **An empty result is a claim about your QUERY** until you have shown the
  query can find something. Run the positive control FIRST.
- **Uniqueness of rendered text is not an invariant** when two independently
  fetched components can produce the same label.
- **A pattern is not a line.** Prose wraps.
- **Passing and passing-by-enough are different properties.** There is a 0.25
  margin gate; solve to a margin.
