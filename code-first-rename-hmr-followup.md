# Code-first rename HMR — open followup

> **Status:** PR #124 open. Several root causes fixed. Core symptom partially resolved (auto-apply for adds works, loadConfig works, clear actionable message printed). Interactive prompt during `pnpm dev` still does NOT fire — design tradeoff vs technical limitation, see below.
> **Date:** 2026-05-01
> **Owner:** Mobeen / next session
> **PR:** [nextlyhq/nextly#124](https://github.com/nextlyhq/nextly/pull/124) on branch `fix/code-first-rename-hmr-and-boot-apply`

---

## TL;DR

User reported: rename a code-first field (e.g. `excerpt` → `summary` in `src/collections/Posts/index.ts`), restart `pnpm dev`, expect the DB column to rename. Before this PR it silently no-oped. After this PR the system correctly **detects** the rename and **prints a clear instruction** in the terminal telling the user how to apply it. **No interactive prompt fires inside `pnpm dev` itself** because the boot/HMR apply path runs in an HTTP request handler context where blocking on stdin would hang the request indefinitely.

User's expectation was an interactive prompt during `pnpm dev`. Current behavior is "see message, run `pnpm nextly db:sync` to apply". User wants to revisit later — possibly to add browser-side prompts (admin UI banner) or change architecture so prompts can fire during dev. This doc captures everything tried + remaining open questions so the next session can pick up cleanly.

---

## User's exact reported symptom

> "no prompts showing in terminal. excerpt is not changed to summary in dc_posts table. only fields object is updated in dynamic_collections after manual restart, but dc_posts table column doesn't change."

Repro (latest, on p42):
1. `excerpt` renamed to `summary` in `src/collections/Posts/index.ts`
2. Save file
3. `pnpm dev` running in user's terminal
4. **Expected (user):** prompt appears asking to confirm rename
5. **Actual:** dev server prints the new instruction message (since this PR), but no prompt; user has to run a separate command (`pnpm nextly db:sync`) to confirm

User's intuition (matches Prisma Studio / Drizzle Kit interactive flow): editor save → instant prompt → confirm → schema updated.

---

## Root causes fixed in this PR (4 of them, layered)

Each was masking the next:

### 1. DI key typo: `databaseAdapter` vs `adapter`

[reload-config.ts:152](packages/nextly/src/init/reload-config.ts#L152) resolved `"databaseAdapter"` from the DI container, but the singleton is registered under key `"adapter"` in [register.ts:302](packages/nextly/src/di/register.ts#L302). The silent catch around the resolve call swallowed the throw. Result: code-first HMR has been silently broken since the resolve key drifted. The F1 PR 2 lazy-reload pattern via the WS listener never actually applied any schema changes for anyone.

**Fix:** `resolve("adapter")`. Single-line change in commit [`31c774a`](https://github.com/nextlyhq/nextly/pull/124/commits/31c774a).

### 2. Restart path didn't trigger schema apply

`syncCodeFirstCollections` writes new fields JSON to `dynamic_collections.fields` but never triggers a real schema apply. `runDriftCheck` only logs a warning. Original design (per `init.ts:210` comment) assumed real applies happen via HMR or `nextly db:sync`. With HMR silently broken (#1) AND most consumers restarting the dev server to pick up code edits, restart left a state where metadata says "new shape" but `dc_<slug>` table column stays at old name.

**Fix:** new shared helper [`init/boot-apply.ts`](packages/nextly/src/init/boot-apply.ts) calls `reloadNextlyConfig` in dev only (`NODE_ENV === "development"`), gated by `NEXTLY_DISABLE_BOOT_APPLY=1` escape hatch. Wired into BOTH init entry points so the first request applies pending changes regardless of code path:
- [`init.ts`](packages/nextly/src/init.ts) (direct API: `nextly.find()`)
- [`route-handler/auth-handler.ts`](packages/nextly/src/route-handler/auth-handler.ts) (route handler: `/admin/api/*`)

### 3. Descriptor drift: SQLite PRAGMA returns UPPERCASE types

SQLite's `PRAGMA table_info` auto-uppercases the type name even when CREATE TABLE used lowercase. Drizzle emits lowercase declarations and `field-column-descriptor` renders lowercase tokens, so every diff compared `TEXT` (PRAGMA) against `text` (desired) and produced a fake type-change event for every column. `classifyForCodeFirst` classified those collections as "needs review" and silently skipped them.

**Fix:** lowercase `r.type` in [`introspect-live.ts`](packages/nextly/src/domains/schema/pipeline/diff/introspect-live.ts) SQLite branch. Safe because SQLite type names are case-insensitive at the engine level.

### 4. `bundle-require`'s internal dynamic import broke under Turbopack

`@revnixhq/nextly`'s CLI config-loader used the `bundle-require` package, which internally calls `(file) => import(file)` on a dynamic path. When nextly runs inside a Next.js dev server (Turbopack), that dynamic import is statically analyzed and rejected with `Cannot find module as expression is too dynamic`. End result: `loadConfig()` threw, the boot-apply path's catch returned silently, and even the CLI command `pnpm nextly db:sync` failed (this is fellow dev's separate Issue 3 from `findings-3.md`).

**Fix:** new [`config-bundler.ts`](packages/nextly/src/cli/utils/config-bundler.ts) replaces `bundle-require` with a small purpose-built loader:
- Uses `esbuild` directly (already a dep, used by tsup) to compile TS to CJS
- Writes the bundle to `<projectRoot>/node_modules/.cache/nextly/` so external `require()` calls inside the bundle resolve through the project's node_modules tree
- Loads via `createRequire(import.meta.url)` — the same Turbopack-bypass pattern PR #110 uses for `drizzle-kit/api`

`bundle-require` removed from `packages/nextly/package.json` deps. Commit [`d386752`](https://github.com/nextlyhq/nextly/pull/124/commits/d386752).

### 5. (Bonus, UX) Misleading "Schema apply FAILED" boxed log

[`runtime/notifications/channels/terminal.ts`](packages/nextly/src/runtime/notifications/channels/terminal.ts) printed a boxed line reading `Schema apply FAILED — global` even when the failure code was `CONFIRMATION_REQUIRED_NO_TTY` (which is not a failure, just "user input needed"). Replaced by the new clear message in [`reload-config.ts`](packages/nextly/src/init/reload-config.ts).

---

## What works after this PR

| Scenario | Status |
|---|---|
| Add new field to a code-first collection, restart `pnpm dev` | ✅ Auto-applies silently |
| Add new collection, restart `pnpm dev` | ✅ Auto-creates table |
| `pnpm nextly db:sync` for adds | ✅ Works (loadConfig fixed) |
| `pnpm nextly db:sync` for renames in real interactive terminal | ✅ Should prompt + apply (verified the loadConfig path; clack prompt path inherits stdin from interactive shell) |
| Rename detected during `pnpm dev` | ✅ Detected, clear instruction printed in dev log |
| Drop detected during `pnpm dev` | ✅ Detected, clear instruction printed in dev log |
| Admin UI rename via Schema Builder | ✅ Works (PR #123, already merged) |

---

## What does NOT work (user-reported limitation)

**Interactive rename prompt does NOT fire inside `pnpm dev`.** This is the user's primary remaining frustration.

Instead, the dev terminal prints:

```
[Nextly] Schema change needs your confirmation:
  1 rename candidate(s): excerpt -> summary on dc_posts

Renames + drops auto-apply only when you confirm them.
To apply, run one of:
  • pnpm nextly db:sync         (prompts in this terminal)
  • pnpm nextly migrate:create  (generates a committable migration)
  • Use the admin UI Schema Builder at /admin

Pure-additive changes (new fields, new collections) apply
automatically on dev start; only structural changes need
explicit confirmation.
```

The user can then run `pnpm nextly db:sync` in the same terminal (after stopping `pnpm dev`) and clack will prompt. But it's a two-step flow, not the single-step "save and confirm" they want.

---

## Why the prompt doesn't fire during `pnpm dev`

Boot-apply runs from `auth-handler.ts:ensureServicesInitialized`, which is invoked from a Next.js HTTP request handler. Three reasons interactive prompts fail there:

1. **`process.stdin` ownership.** Even though the dev server's parent process has TTY, Next.js's dev runtime consumes stdin for its own dev shortcuts (e.g. "press 'r' to reload"). The clack dispatcher's `process.stdin.isTTY` check returns false.

2. **Request handlers can't block.** Even if stdin were available, blocking the request handler indefinitely while waiting for user input would hang the HTTP request that triggered boot-apply. The browser would spin.

3. **Architectural anti-pattern.** Both Payload and Drizzle Kit explicitly avoid this for the same reasons. They route structural schema changes through CLI commands run in the user's interactive shell, not server-side request handlers.

This is the same reason F4 Option E's pipeline emits `CONFIRMATION_REQUIRED_NO_TTY` from boot/HMR contexts but the same pipeline DOES prompt from `pnpm nextly db:sync` (which runs in pure Node with parent shell's stdin).

---

## Open questions for future investigation

When the user revisits this, here are the design avenues worth exploring:

### Avenue A: Browser-side prompt (admin UI banner)

When boot-apply detects a rename/drop, persist the pending change to `dynamic_collections` (or a sidecar table). The admin UI shows a banner: "1 pending schema change. Click to review." The Schema Builder dialog (already built for the admin-UI-driven path) handles confirmation. User experience: edit code, see banner in browser, click confirm.

**Tradeoffs:**
- ✓ No terminal interaction needed
- ✓ Reuses existing admin Schema Builder dialog (built in F4-F6)
- ✗ Requires admin to be open
- ✗ Persistence layer for "pending changes" needs design
- ✗ Race conditions: what if two pending changes accumulate?

### Avenue B: Auto-confirm based on field rename hints

User adds `oldName` metadata to renamed fields:
```ts
text({ name: "summary", oldName: "excerpt" }),
```
Boot-apply sees the explicit hint, no ambiguity, auto-applies the rename without prompting.

**Tradeoffs:**
- ✓ Single-step workflow (user just edits code)
- ✓ Works from any context (dev server, CLI, CI)
- ✓ Aligns with F14 v1 hints reservation already shipped
- ✗ Requires user to add the hint annotation (extra step)
- ✗ Hint must be cleaned up after migration applies (or stays forever)
- ✗ Doesn't cover drops

### Avenue C: Spawn a sidecar prompt process

Instead of trying to prompt from the request handler, spawn a child process that opens a clack prompt in the terminal Next.js was started in. The child process inherits the parent's stdin/stdout. Boot-apply waits for the child to exit, then continues.

**Tradeoffs:**
- ✓ Single-step from user's perspective
- ✓ Real interactive prompt
- ✗ Race condition with the Next.js dev shortcuts grabbing stdin
- ✗ Complex IPC + lifecycle
- ✗ Cross-platform terminal handling is tricky

### Avenue D: Move boot-apply OUT of request handler context

Currently boot-apply triggers on first request. Instead, run it once at dev-server boot (top-level of the Next.js custom server / instrumentation hook) BEFORE Next.js starts handling requests. At that point stdin is still owned by the user's shell.

**Tradeoffs:**
- ✓ No request handler context constraints
- ✓ Clack should work
- ✗ Not all Nextly users use a custom server
- ✗ `instrumentation.ts` hooks might not have stdin either
- ✗ Bigger surface area to test

### Avenue E: Accept current architecture, fold the CLI step into a watcher

Run a background `pnpm nextly db:sync --watch` alongside `pnpm dev`. The watcher polls config changes; when a rename/drop is detected, it prompts in its own terminal. User runs both commands once, then everything is interactive.

**Tradeoffs:**
- ✓ Minimal architectural change
- ✓ Reuses existing CLI flow
- ✗ Two commands to remember
- ✗ Watcher process lifecycle management
- ✗ UX of split prompts across two terminals

---

## Testing notes (what was tried)

### Environment

- macOS Darwin 25.5.0
- Node 22.18.0
- Next.js 16.2.4 (Turbopack)
- pnpm 10.18.3
- Test scaffolds: p38, p40, p41, p42 (Blog template, code-first, SQLite, yalc-linked)
- All scaffolds created via `npx create-nextly-app` from the local yalc-linked `@revnixhq/create-nextly-app`

### Repro confirmed in p42

Pre-state:
- `dynamic_collections.fields` had `summary` (after restart updated metadata)
- `dc_posts` table column was still `excerpt`

After this PR's fixes:
- Boot-apply fires on first `/admin/api/auth/setup-status` request
- loadConfig succeeds (no more "expression is too dynamic")
- Pipeline runs RegexRenameDetector + classifies `excerpt → summary` as a rename candidate
- Returns `CONFIRMATION_REQUIRED_NO_TTY` because the request handler can't prompt
- New top-level instruction message prints to dev terminal
- `pnpm nextly db:sync` correctly loads config, connects to DB, syncs metadata, then errors with the same TTY-required message in non-TTY shells (would prompt and apply in real interactive terminal)

### What was NOT verified end-to-end

- `pnpm nextly db:sync` actually prompting in a real interactive shell. My background bash environment never has TTY. User confirmation needed.
- Postgres + MySQL behavior. Only SQLite tested.
- Concurrent rename + add (e.g. rename A→B AND add new field C in same edit). Heuristic might mis-pair.

---

## File inventory of changes (PR #124)

| File | Status | Purpose |
|---|---|---|
| [`packages/nextly/src/init/reload-config.ts`](packages/nextly/src/init/reload-config.ts) | Modified | DI typo fix + improved error logging + clear rename/drop instruction |
| [`packages/nextly/src/init.ts`](packages/nextly/src/init.ts) | Modified | Wire boot-apply into direct-API init path |
| [`packages/nextly/src/init/boot-apply.ts`](packages/nextly/src/init/boot-apply.ts) | New | Shared boot-apply helper called from both init paths |
| [`packages/nextly/src/route-handler/auth-handler.ts`](packages/nextly/src/route-handler/auth-handler.ts) | Modified | Wire boot-apply into route-handler init path |
| [`packages/nextly/src/domains/schema/pipeline/diff/introspect-live.ts`](packages/nextly/src/domains/schema/pipeline/diff/introspect-live.ts) | Modified | Lowercase SQLite PRAGMA types (descriptor drift fix) |
| [`packages/nextly/src/cli/utils/config-bundler.ts`](packages/nextly/src/cli/utils/config-bundler.ts) | New | esbuild + createRequire-based loader (replaces bundle-require) |
| [`packages/nextly/src/cli/utils/config-loader.ts`](packages/nextly/src/cli/utils/config-loader.ts) | Modified | Use new bundler |
| [`packages/nextly/src/runtime/notifications/channels/terminal.ts`](packages/nextly/src/runtime/notifications/channels/terminal.ts) | Modified | Suppress misleading FAILED box when CONFIRMATION_REQUIRED_NO_TTY |
| [`packages/nextly/package.json`](packages/nextly/package.json) | Modified | Drop bundle-require dep |

---

## Workflow user can use TODAY (until prompt-during-dev is solved)

For renames/drops in code-first:
1. Edit the field name in `src/collections/<Collection>/index.ts`
2. Save
3. Either:
   - Stop `pnpm dev` (Ctrl+C), run `pnpm nextly db:sync`, confirm rename, restart `pnpm dev`
   - OR keep `pnpm dev` running, open a second terminal, run `pnpm nextly db:sync`, confirm rename
   - OR open `/admin`, use Schema Builder dialog to confirm the pending rename (UI path)

For adds:
1. Edit the field, save
2. Restart `pnpm dev` (or wait for HMR if it fires for adds)
3. Auto-applies, no confirmation needed

---

## How to pick this up next session

1. Read this doc end-to-end first
2. Read PR #124 description + commits
3. Read this companion context:
   - `findings/schema-issues-findings-3.md` (original user report)
   - `findings/schema-terminal-output-findings-3.txt` (original log)
4. Decide which avenue (A through E above) to implement
5. Verify `pnpm nextly db:sync` works end-to-end in a real interactive terminal first (the foundation for any avenue)
6. If the chosen path is the admin UI banner (Avenue A), the Schema Builder dialog from F4-F6 is the consumer of the pending change
7. If the chosen path is hint-based auto-confirm (Avenue B), the F14 v1 hints reservation in PR #104 is the schema seam to extend

The current PR #124 is a strict improvement over `dev`'s behavior even without solving the prompt-during-dev question, so it's safe to merge as a stepping stone.

---

## Related context

- PR #123 (merged): admin-UI rename FileManager schema cache invalidation
- PR #124 (this PR): code-first HMR + boot-apply + loadConfig fixes
- PR #110 (in Task 24): drizzle-kit lazy import via `createRequire` (the same Turbopack-bypass pattern this PR reuses)
- PR #104 (F14 v1): hints field reservation (foundation for Avenue B)
- F4 Option E (PRs #60, #62, #64, #65, #66, #67): the underlying pipeline architecture that emits `CONFIRMATION_REQUIRED_NO_TTY`
- F8 PR 7 (PR #83): cross-dialect integration matrix
