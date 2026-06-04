# Manual Testing Playbook — Migration System

A complete, hands-on guide for manually exercising **every** part of the Nextly
migration system: all CLI commands, schema authoring (code-first + UI), the
migrate lock, rollback (`migrate:down`), production run-on-boot migrations, and
the CI/build-process integration. Each section says **what to run**, **what you
should see**, and **how to verify it in the database**.

> **Safety first.** Several commands drop tables. Point `DATABASE_URL` at a
> **throwaway** database (a Neon branch, a local Postgres, etc.) — **never** a
> real/production DB. This guide assumes the contributor playground at
> `apps/playground`.

---

## 0. Prerequisites & setup

### 0.1 Where commands run

All commands run from **`apps/playground`** and need the env loaded:

```bash
cd apps/playground
```

Invoke the CLI one of these ways (they're equivalent):

```bash
pnpm exec nextly <cmd>                 # uses the workspace nextly bin
# or, if pnpm complains about its version pin:
./node_modules/.bin/nextly <cmd>
# or run from source (no build needed), loading .env explicitly:
pnpm exec tsx --env-file=.env ../../packages/nextly/src/cli/nextly.ts <cmd>
```

Commands that connect to the DB read `DATABASE_URL` from the environment. With
`pnpm exec nextly` the playground scripts load `.env` for you; with raw `tsx`
add `--env-file=.env` (as shown above).

### 0.2 Environment variables

| Variable                                   | Purpose                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                             | Connection string. Dialect is auto-detected from the URL scheme. **Must be a throwaway DB.** |
| `DB_DIALECT`                               | Optional override: `postgresql` \| `mysql` \| `sqlite`.                                      |
| `NODE_ENV`                                 | `production` enables run-on-boot migrations and the `migrate:down --yes` guard.              |
| `NEXTLY_ALLOW_CORE_DESTRUCTIVE=1`          | Allow destructive **core** schema reconcile (version mismatch recovery).                     |
| `NEXTLY_ALLOW_CODE_FIRST_DROPS=1`          | Auto-confirm destructive **code-first** drops in non-interactive runs.                       |
| `NEXTLY_DISABLE_INSTRUMENTATION_WARNING=1` | Silence the cold-boot warning.                                                               |

### 0.3 Where things live

- Migration files: `apps/playground/src/db/migrations/*.sql`
- Paired snapshots: `apps/playground/src/db/migrations/meta/*.snapshot.json`
- Code-first collections: `apps/playground/src/collections/*.ts` (+ registered in `nextly.config.ts`)
- UI-built manifest: `apps/playground/ui-schema.json`
- Bookkeeping table (in the DB): `nextly_schema_events`
- Lock table (in the DB): `nextly_migrate_lock`

---

## 1. Command reference (what each does)

| Command                        | Purpose                                                                                                  | Connects to DB? |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | --------------- |
| `nextly migrate:create [name]` | Diff config + `ui-schema.json` vs the latest snapshot → write a `.sql` (UP + DOWN) and `.snapshot.json`. | No              |
| `nextly migrate:check`         | CI gate: verify file integrity + config drift.                                                           | No              |
| `nextly migrate`               | Apply all pending migration files (Phase 1 core reconcile + Phase 2 user files), under the lock.         | Yes             |
| `nextly migrate:status`        | Show applied / pending / failed per migration.                                                           | Yes             |
| `nextly migrate:down`          | Roll back the most-recently-applied migration(s) via their `-- DOWN` section.                            | Yes             |
| `nextly migrate:resolve`       | Fix bookkeeping (mark applied / rolled-back / failed-cleanup) without running SQL.                       | Yes             |
| `nextly migrate:fresh`         | Drop **every** table and replay all migrations. Local-dev only.                                          | Yes             |

Global flags: `--config <path>`, `--cwd <path>`, `--verbose`, `-q/--quiet`.

---

## 2. Authoring schema (two ways)

Both feed the same migration pipeline.

### 2.1 Code-first (in `nextly.config.ts`)

Create `apps/playground/src/collections/widgets.ts`:

```ts
import {
  defineCollection,
  relationship,
  repeater,
  text,
  textarea,
} from "nextly/config";

export const Widgets = defineCollection({
  slug: "widgets",
  labels: { singular: "Widget", plural: "Widgets" },
  fields: [
    text({ name: "title", required: true }),
    text({ name: "slug", required: true, unique: true }),
    textarea({ name: "summary" }),
    relationship({ name: "owner", relationTo: "authors" }),
    repeater({
      name: "specs",
      fields: [text({ name: "spec_name", required: true })],
    }),
  ],
});
```

Register it in `nextly.config.ts`:

```ts
import { Widgets } from "./src/collections/widgets";
// ...
collections: [ /* ...existing..., */ Widgets ],
```

> Avoid SQL reserved words for field names (`role`, `order`, `user`, …) — the
> config validator rejects them with a clear message.

### 2.2 Admin UI (the builder)

1. Start the dev server (`pnpm dev:app` from repo root, or `./node_modules/.bin/next dev --port 3122`).
2. Visit `/admin` → builder → create a collection/single/component, add fields, Save.
3. Confirm the entry landed in `apps/playground/ui-schema.json`.

**What to verify:** the builder always **dual-writes** — the table appears in the
dev DB immediately **and** `ui-schema.json` gets the entry (with **all** fields,
not just title/slug). Create, edit, and delete all stay in sync across the DB and
`ui-schema.json`.

---

## 3. The core flow: create → apply → verify

> **Stop the dev server first** — it holds the migrate lock and auto-applies in dev.

### 3.1 Create a migration

```bash
pnpm exec nextly migrate:create --name=add_widgets
```

Interactive runs may prompt about possible column/table renames. For CI/non-TTY:

```bash
pnpm exec nextly migrate:create --name=add_widgets --non-interactive
# add --accept-renames only after you've reviewed the diff interactively
```

**Expect:**

```
✓ Created migration → .../migrations/20260604_..._add_widgets.sql
✓ Snapshot → .../migrations/meta/20260604_..._add_widgets.snapshot.json
  Operations: 1
```

Exit codes: `0` = file written, `2` = no changes detected, `1` = error.

**Inspect the file** — it now contains both sections:

```sql
-- UP
CREATE TABLE "dc_widgets" ( ... );

-- DOWN
DROP TABLE "dc_widgets" CASCADE;
```

A **blank** migration (`--blank`) writes an empty `-- UP`/`-- DOWN` for hand-written SQL.

### 3.2 Apply

```bash
pnpm exec nextly migrate
```

**Expect:**

```
ℹ Phase 1: reconciling core schema...
ℹ Phase 2: applying user migrations...
✓ Applied 20260604_..._add_widgets.sql
✓ 1 migration applied.
```

(`Blocked DROP TABLE ...` warnings during Phase 1 are the drop-guard protecting
tables not in the current desired schema — informational, not errors.)

Preview without executing:

```bash
pnpm exec nextly migrate --dry-run     # lists pending files, makes no changes
pnpm exec nextly migrate --step 1      # apply only the next 1 pending file
```

### 3.3 Status & check

```bash
pnpm exec nextly migrate:status          # table of Applied / Pending / Failed
pnpm exec nextly migrate:status --json   # machine-readable (CI)
pnpm exec nextly migrate:check           # offline integrity + drift gate
```

**Expect** `migrate:status` to list your migration as `Applied`, and
`migrate:check` to print `migrate:check OK — N migration file(s), no drift.`

### 3.4 Verify in the database

Collections → `dc_<slug>`; singles → `single_<slug>`; components → `comp_<slug>`.
Field-type → column mapping:

| Field type                                            | Column                          |
| ----------------------------------------------------- | ------------------------------- |
| `text` / `email` / `select` / `radio`                 | `text`                          |
| `relationship` (single)                               | `text` (FK id)                  |
| `repeater` / `group` / `component` / `json` / `chips` | `jsonb`                         |
| `checkbox`                                            | `boolean`                       |
| `number`                                              | `int4` (or `float8` if decimal) |
| `date`                                                | `timestamp`                     |

Every managed table also has `id`, `title`, `slug`, `created_at`, `updated_at`.

---

## 4. Rollback (`migrate:down`)

Each generated migration carries a `-- DOWN` section (the inverse of its `-- UP`).
`migrate:down` runs it to revert the most-recently-applied migration.

### 4.1 Flags

| Flag                | Effect                                                     |
| ------------------- | ---------------------------------------------------------- |
| `--step <n>`        | Roll back the last N migrations (default 1), newest first. |
| `--allow-data-loss` | Required when the DOWN drops a table or column.            |
| `--yes`             | Required when `NODE_ENV=production`.                       |
| `--dry-run`         | Print targets + their DOWN SQL; execute nothing.           |
| `--force-unlock`    | Clear a stale lock first.                                  |

### 4.2 Round-trip test

```bash
# 1. Preview — shows the DOWN SQL + annotations, makes no changes
pnpm exec nextly migrate:down --dry-run
#   ℹ Would roll back 1 migration(s):
#   ℹ   • 20260604_..._add_widgets.sql
#   ℹ     ⚠ drops a table or column — a real run needs --allow-data-loss
#   ℹ DROP TABLE "dc_widgets" CASCADE;

# 2. Without --allow-data-loss on a destructive DOWN → refuses
pnpm exec nextly migrate:down
#   ✗ Rolling back ... drops a table or column (data loss). Re-run with --allow-data-loss.

# 3. Roll it back
pnpm exec nextly migrate:down --allow-data-loss
#   ✓ Rolled back 20260604_..._add_widgets.sql
#   ✓ Rolled back 1 migration(s). Schema shape was restored; row data was NOT recovered.

# 4. It is pending again (re-runnable)
pnpm exec nextly migrate:status        # add_widgets -> Pending

# 5. Re-apply
pnpm exec nextly migrate               # add_widgets -> Applied
```

### 4.3 Things to confirm

- **`dc_widgets` is gone** after step 3 (and the row in `nextly_schema_events`
  for that file now has status `rolled_back`).
- **Schema shape only, not data.** Reverting an added column re-creates it
  **empty** on re-apply — old rows are gone. Verify by adding a row, rolling
  back, re-applying: the table is back but empty.
- **Irreversible migrations are refused.** A migration with an empty `-- DOWN`
  (e.g. `--blank` or a data-only migration) → `migrate:down` aborts with
  "irreversible … hand-write a -- DOWN section or use `migrate:fresh`." Test by
  creating a `--blank` migration, applying it, then `migrate:down`.
- **`--step 2`** rolls back the two newest applied migrations, newest first.

---

## 5. Recovery (`migrate:resolve`)

Fixes bookkeeping in `nextly_schema_events` **without** running migration SQL.
Exactly one mode per call; all are idempotent and take the lock.

```bash
# Mark a file applied (e.g. it was applied out-of-band). Verifies live == the
# file's target snapshot first.
pnpm exec nextly migrate:resolve --applied 20260604_..._add_widgets

# Same, but SKIP the live-vs-snapshot check. Use this to baseline a DB whose
# schema already differs from the snapshot — e.g. you built collections in the
# UI (which applied them to the dev DB), so `--applied` reports
# "Live schema does not match the target snapshot."
pnpm exec nextly migrate:resolve --applied 20260604_..._add_widgets --skip-verify

# Record a rolled_back event so the next `migrate` re-runs the file.
pnpm exec nextly migrate:resolve --rolled-back 20260604_..._add_widgets

# Flip a stuck failed event to rolled_back so you can edit the .sql and retry.
pnpm exec nextly migrate:resolve --failed-cleanup 20260604_..._add_widgets
```

> `--skip-verify` is an option of **`migrate:resolve`**, not `migrate`. Running
> `nextly migrate --skip-verify` errors with "unknown option."

**Test idempotency:** run `--applied` on an already-applied file → it prints
"is already marked applied." and exits `0` (no error).

---

## 6. The migrate lock

`migrate`, `migrate:down`, and `migrate:resolve` acquire a pooler-safe lock
(a TTL row in `nextly_migrate_lock`) so two schema operations never run at once.

### 6.1 Test concurrent contention

In one terminal, start a migrate that takes a moment; in a second terminal run
another `migrate` immediately. The second should fail fast:

```
✗ Another schema operation holds the migrate lock. Wait for it to finish
  (a running dev server also holds it) and retry, or run with `--force-unlock`.
```

### 6.2 Clear a stale lock

If a previous run crashed and left the lock held:

```bash
pnpm exec nextly migrate --force-unlock        # clears, then migrates
pnpm exec nextly migrate:down --force-unlock   # same, for rollback
```

The lock also has a TTL (default 900s, configurable via `db.migrateLockTtlSeconds`)
so it self-expires; `--force-unlock` is the immediate override.

---

## 7. `migrate:fresh` (drop everything + replay)

```bash
pnpm exec nextly migrate:fresh            # prompts for confirmation
pnpm exec nextly migrate:fresh --force    # skip confirmation
pnpm exec nextly migrate:fresh --seed     # run seeders afterwards
```

**Expect:** `✓ Dropped N tables`, then every migration re-applied from scratch,
ending Applied.

> **`migrate:fresh` does NOT leave the DB empty.** It drops all tables (with
> `DROP TABLE ... CASCADE`) and then **re-runs every migration**, so the tables
> are _re-created_. Seeing tables after a successful `fresh` is expected. If you
> want a truly empty DB + reseed, use `pnpm dev:reset` (§7.1).

> ⚠️ **TTY required for the core rebuild.** When the database is empty (or only
> the `nextly_migrate_lock` table remains), rebuilding the **core** schema goes
> through drizzle-kit's interactive resolver, which needs a real terminal
> (it reads raw keypresses). In a piped / CI / non-TTY shell it aborts with
> _"Interactive prompts require a TTY terminal."_ Run `migrate:fresh` (and the
> first-ever `migrate` against an empty DB) from an **interactive terminal**, or
> let the **dev server** bootstrap the schema on first boot. If you ever end up
> with an empty DB in a non-TTY context, rebuild it from your own terminal:
> `pnpm exec nextly migrate` and press Enter through the "create table" prompts.

### 7.1 `pnpm dev:reset` (full wipe + reseed)

The playground's reset script wipes the DB **and** local file state (`.next`,
`.turbo`, generated types, `src/db/migrations`, …), then reseeds. Unlike
`migrate:fresh` (which replays migrations), this drops the whole schema and
re-bootstraps from the framework's first-run setup.

```bash
cd apps/playground
pnpm dev:reset                          # dialect auto-detected from DATABASE_URL
DB_DIALECT=postgresql pnpm dev:reset    # explicit override (optional)
```

> The dialect is now **auto-detected from `DATABASE_URL`** — a `postgres://` /
> `mysql://` / `file:` URL picks Postgres / MySQL / SQLite. (Previously it
> defaulted to SQLite, so a bare `pnpm dev:reset` against a Postgres URL silently
> left the real DB untouched. Setting `DB_DIALECT` is no longer required.)

---

## 8. Production migrations (run-on-boot)

In production you typically run `nextly migrate` from CI before deploy (see §9).
As an **opt-in** alternative, the app can apply committed migrations on boot.

### 8.1 Enable it

In `nextly.config.ts`:

```ts
db: {
  // ...
  runMigrationsOnBoot: true,        // default false; PRODUCTION only
  migrateLockTtlSeconds: 900,       // optional
},
```

Behavior:

- **No-op unless `NODE_ENV=production`** AND `runMigrationsOnBoot === true`.
- Runs under the lock in **wait** mode, so N instances booting together don't
  race — one applies while the others wait, then all boot with the schema ready.
- **Failure-safe:** a failed migration is logged loudly but does **not** crash
  the app boot (you then run `nextly migrate` to resolve).

### 8.2 How to test it (throwaway DB)

1. Create a migration but **don't** apply it (`migrate:create`, then _not_ `migrate`).
2. Confirm it's pending: `pnpm exec nextly migrate:status` → `Pending`.
3. Set `runMigrationsOnBoot: true` in config.
4. Boot the app with `NODE_ENV=production` (or call the boot path). Watch the logs for:
   ```
   [Nextly] Running production migrations on boot...
   Applied 20260604_..._<name>.sql
   [Nextly] Boot migrations complete (1 applied).
   ```
5. Confirm with `migrate:status` → now `Applied`.

**Negative test:** boot with `NODE_ENV=development` → you should see **no**
"Running production migrations" line and the migration stays Pending.

---

## 9. Build process / CI integration

The deployed app must **not** migrate at runtime; run migrations as a deploy step.

### 9.1 Local CI script

`apps/playground/package.json` has:

```json
"scripts": {
  "ci": "nextly migrate && next build"
}
```

The `&&` gates the build on a successful migrate — if `migrate` exits non-zero,
the build never runs. Test the gating:

```bash
# migrate succeeds (exit 0) -> build proceeds
pnpm exec nextly migrate && echo "GATE PASSED: build would run"
```

### 9.2 Recommended deploy patterns

1. **CI runs migrate before deploy (recommended).** A CI job with prod DB
   credentials runs `nextly migrate`; only on success does the deploy proceed.
   Old code keeps serving on the old schema if migrate fails.
2. **Build step migrates** (`nextly migrate && next build`) — simplest.
3. **Manual deploy** — run `nextly migrate` from a trusted machine.
4. **Run on boot** (opt-in, §8) — for platforms without a separate migrate step.

`nextly migrate:check` is a good **CI gate** that needs no DB: it fails the
build if a migration file was tampered with or the config drifted from snapshots.

See `docs/guides/production-migrations.mdx` for full CI examples.

---

## 10. Full end-to-end scenarios

### 10.1 Happy path

1. Author a collection (code-first and/or UI).
2. `migrate:create --name=...` → review the `-- UP` / `-- DOWN`.
3. `migrate:check` → OK.
4. `migrate` → Applied.
5. `migrate:status` → Applied; verify columns in the DB.

### 10.2 Rollback round-trip

1. `migrate:down --dry-run` → preview.
2. `migrate:down --allow-data-loss` → reverted; table gone; event `rolled_back`.
3. `migrate:status` → Pending.
4. `migrate` → re-applied.

### 10.3 Production boot

1. Leave a migration pending.
2. `runMigrationsOnBoot: true` + `NODE_ENV=production` → boot → auto-applied.
3. Repeat with `NODE_ENV=development` → no-op.

### 10.4 Lock contention

1. Two concurrent `migrate` runs → second fails fast with the lock message.
2. `migrate --force-unlock` clears a stale lock.

### 10.5 Clean reset (interactive terminal)

1. `migrate:fresh --force` → drops all, **replays all migrations** → Applied. _(Recreates the schema; not an empty DB.)_
2. `pnpm dev:reset` → full wipe of DB + local file state, then reseed (§7.1). Dialect auto-detected from `DATABASE_URL`.

---

## 11. Troubleshooting

| Symptom                                                                        | Cause / fix                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Another schema operation holds the migrate lock.`                             | A dev server or prior run holds the lock. Stop the dev server / wait for the TTL, or `--force-unlock`.                                                                                                                                                                                        |
| `Interactive prompts require a TTY terminal.`                                  | From-empty core rebuild needs a real terminal (§7). Run from an interactive shell or boot the dev server.                                                                                                                                                                                     |
| `schema drift detected` after building in the UI                               | The builder applies to the dev DB immediately, so `migrate` run against that **same** DB sees the tables already present. Expected — test the migrate pipeline against a **clean/other** DB, baseline with `nextly migrate:resolve --applied <file> --skip-verify`, or `migrate:fresh` first. |
| `migrate:resolve --applied` → "Live schema does not match the target snapshot" | The DB drifted from that migration's snapshot (e.g. you built it in the UI). Re-run with `--skip-verify` to baseline it: `migrate:resolve --applied <file> --skip-verify`. (`--skip-verify` is a `migrate:resolve` flag, not a `migrate` flag.)                                               |
| `pnpm dev:reset` "didn't reset" Postgres / tables remain                       | Fixed: `dev:reset` now auto-detects the dialect from `DATABASE_URL`. If on an older checkout, it defaulted to SQLite — `git pull`, or pass `DB_DIALECT=postgresql pnpm dev:reset`.                                                                                                            |
| Tables still present after `migrate:fresh`                                     | Expected — `fresh` drops **then re-runs migrations**, recreating them. It's not meant to leave the DB empty; use `pnpm dev:reset` for that.                                                                                                                                                   |
| `migrate:down` says "irreversible"                                             | The migration has an empty `-- DOWN` (data-only / `--blank`). Hand-write a DOWN or use `migrate:fresh`.                                                                                                                                                                                       |
| `migrate:create` exits `2`                                                     | No changes detected — config matches the latest snapshot. Not an error.                                                                                                                                                                                                                       |
| Destructive **core** reconcile refused                                         | Version mismatch. Re-run with `NEXTLY_ALLOW_CORE_DESTRUCTIVE=1` after reading the release notes.                                                                                                                                                                                              |
| Boot migration failed but app still up                                         | By design (failure-safe). Check logs, then run `nextly migrate` manually.                                                                                                                                                                                                                     |
| MySQL left partial state after a failed migration                              | MySQL auto-commits DDL per statement; manual cleanup may be needed (see DB support docs).                                                                                                                                                                                                     |

---

## 12. Quick smoke test (copy/paste)

From an **interactive terminal**, against a **throwaway** DB:

```bash
cd apps/playground

pnpm exec nextly migrate:status                       # baseline
pnpm exec nextly migrate:create --name=smoke --non-interactive   # (after editing config)
pnpm exec nextly migrate:check                        # OK
pnpm exec nextly migrate                              # Applied
pnpm exec nextly migrate:down --dry-run               # preview
pnpm exec nextly migrate:down --allow-data-loss       # revert
pnpm exec nextly migrate:status                       # Pending
pnpm exec nextly migrate                              # re-applied
```

If every step prints what this guide describes, the migration system is healthy.
