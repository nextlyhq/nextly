# Testing the Migration Workflow (team guide)

A hands-on guide to what's working **today** on `feat/ui-schema-dual-write`:
the migration CLI, and authoring schema two ways — **code-first** and via the
**admin UI** — both of which feed the same migrations.

> All commands run from **`apps/playground`**. Use `pnpm exec nextly <cmd>`
> (or `./node_modules/.bin/nextly <cmd>` if pnpm complains about its version).
> Make sure `DATABASE_URL` in `apps/playground/.env` points at a **throwaway**
> Postgres DB — several commands drop tables.

> **Looking for the full playbook?** This page is the quick reference. For an
> exhaustive manual-testing guide — every command + flag, the migrate lock,
> rollback, production run-on-boot, CI/build integration, and troubleshooting —
> see [manual-testing-migrations.md](./manual-testing-migrations.md).

---

## 1. The migration commands

| Command                                   | What it does                                                                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `nextly migrate:status`                   | Table of which migrations are applied / pending                                                                                                 |
| `nextly migrate:check`                    | Reports drift / "no drift" without changing anything                                                                                            |
| `nextly migrate:create <name>`            | Generates a migration from `nextly.config.ts` **+** `ui-schema.json` (diffed against the latest snapshot). Writes a `.sql` + a `.snapshot.json` |
| `nextly migrate`                          | Applies all pending migrations                                                                                                                  |
| `nextly migrate:fresh`                    | **Drops every table** and replays all migrations from scratch                                                                                   |
| `nextly migrate:resolve --applied <file>` | Marks a migration applied without running it (e.g. it was applied out-of-band)                                                                  |
| `nextly migrate:down`                     | Rolls back the most-recently-applied migration using its `-- DOWN` section (see section 3b)                                                     |

**Migrations live in:** `apps/playground/src/db/migrations/*.sql`
(paired snapshots in `.../migrations/meta/*.snapshot.json`).

---

## 2. Two ways to author a collection / single

Both produce schema that `migrate:create` picks up.

### A. Code-first (in `nextly.config.ts`)

Create a file in `apps/playground/src/collections/` and add it to the
`collections` array. Supported field types include `text`, `textarea`,
`richText`, `email`, `number`, `checkbox`, `date`, `select`, `radio`, `upload`,
`relationship`, `repeater`, `group`, `json`.

```ts
import { defineCollection, relationship, repeater, text } from "nextly/config";

export const Books = defineCollection({
  slug: "books",
  labels: { singular: "Book", plural: "Books" },
  fields: [
    text({ name: "name", required: true }),
    relationship({ name: "author", relationTo: "authors" }),
    repeater({
      name: "chapters",
      fields: [text({ name: "chapter_title", required: true })],
    }),
  ],
});
```

> Avoid SQL reserved words for field names (e.g. `role`, `order`, `user`) — the
> config validator will reject them with a clear message.

### B. Admin UI (the builder)

1. The builder always **dual-writes**: every create/edit/delete applies to the
   dev DB **and** writes the committable `ui-schema.json`. (No mode flag.)
2. Start the dev server: `pnpm dev:app` (from the repo root).
3. Go to `/admin` → builder → create a **collection** or **single**, add fields
   (the picker now offers the full canonical set, incl. `relationship` +
   `repeater`), and Save.
4. Confirm it landed in `apps/playground/ui-schema.json` (collections under
   `collections`, singles under `singles`).

The builder writes the same field shape for collections, singles, and components.

---

## 3. End-to-end test (the canonical flow)

The reliable way to verify the whole pipeline. **Stop the dev server first** (it
holds the migrate lock and auto-applies in dev).

```bash
cd apps/playground

# 1. (author some schema — code-first and/or via the UI, per section 2)

# 2. Generate one migration capturing all pending changes
pnpm exec nextly migrate:create my_change      # -> new .sql + .snapshot.json

# 3. Reset to a clean DB, then apply everything from scratch
pnpm exec nextly migrate:fresh                 # drops all, replays all migrations (type 'yes')

# 4. Confirm
pnpm exec nextly migrate:status                # everything -> Applied
```

### What to verify in the DB

Collections → `dc_<slug>` tables; singles → `single_<slug>` tables. Field-type →
column mapping:

| Field type                            | Column                          |
| ------------------------------------- | ------------------------------- |
| `text` / `email` / `select` / `radio` | `text`                          |
| `relationship` (single)               | `text` (FK id)                  |
| `repeater` / `group` / `json`         | `jsonb`                         |
| `checkbox`                            | `boolean`                       |
| `number`                              | `int4` (or `float8` if decimal) |
| `date`                                | `timestamp`                     |

Every table also gets `id`, `title`, `slug`, `created_at`, `updated_at`.

---

## 3b. Testing rollback (`migrate:down`)

Each generated migration carries a `-- DOWN` section (the inverse of its `-- UP`).
`migrate:down` runs it to revert the last applied migration.

```bash
# 1. Create + apply a migration that adds a collection/field
nextly migrate:create --name=add_demo
nextly migrate

# 2. Inspect the generated DOWN section
#    open the new migrations/<ts>_add_demo.sql and read the -- DOWN block

# 3. Preview the rollback (no changes made)
nextly migrate:down --dry-run

# 4. Roll it back. It drops the demo table/column, so --allow-data-loss is required
nextly migrate:down --allow-data-loss

# 5. Confirm it is pending again, then re-apply
nextly migrate:status
nextly migrate
```

Notes:

- Rollback restores schema **shape**, not row **data** — a re-added column comes
  back empty.
- A migration with an empty `-- DOWN` (data-only or `--blank`) is **irreversible**;
  `migrate:down` refuses it. Use `migrate:fresh` or a corrective migration instead.
- In `NODE_ENV=production`, `migrate:down` also requires `--yes`.

---

## 4. Known caveats (being worked on)

- **"Another schema operation holds the migrate lock."** The migrate lock leaks
  through Neon's PgBouncer pooler — a previous run can leave a stale lock that
  blocks the next `migrate`. **Workaround:** wait ~30s and retry, or make sure no
  dev server is running. (A pooler-safe lock + `--force-unlock` is the next thing
  being built.)
- **Database-mode + `migrate` on the _same_ DB shows drift.** Database mode
  applies a collection to the DB immediately, so running `migrate` against that
  same DB sees the table already there → "schema drift detected." This is
  expected — the migration is meant for a **clean / other** DB (staging/prod).
  Always **reset first** (`migrate:fresh`) when testing the migrate pipeline.
- **Dev server.** Prefer `pnpm dev:app` from the repo root. If its wrapper errors
  on the pnpm version, run `./node_modules/.bin/next dev --port 3122` from
  `apps/playground` instead.
- **Throwaway DB only.** `migrate:fresh` drops everything — never point it at a
  database you care about.

---

## 5. Quick smoke test (copy/paste)

```bash
cd apps/playground
pnpm exec nextly migrate:status     # see current state
pnpm exec nextly migrate:fresh      # clean rebuild from migrations (type 'yes')
pnpm exec nextly migrate:status     # all Applied
pnpm exec nextly migrate:check      # "no drift"
```

If those four pass, the migration pipeline is healthy on your machine.
