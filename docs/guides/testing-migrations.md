# Testing the Migration Workflow (team guide)

A hands-on guide to what's working **today** on `feat/ui-schema-dual-write`:
the migration CLI, and authoring schema two ways — **code-first** and via the
**admin UI** — both of which feed the same migrations.

> All commands run from **`apps/playground`**. Use `pnpm exec nextly <cmd>`
> (or `./node_modules/.bin/nextly <cmd>` if pnpm complains about its version).
> Make sure `DATABASE_URL` in `apps/playground/.env` points at a **throwaway**
> Postgres DB — several commands drop tables.

---

## 1. The migration commands

| Command | What it does |
|---|---|
| `nextly migrate:status` | Table of which migrations are applied / pending |
| `nextly migrate:check` | Reports drift / "no drift" without changing anything |
| `nextly migrate:create <name>` | Generates a migration from `nextly.config.ts` **+** `ui-schema.json` (diffed against the latest snapshot). Writes a `.sql` + a `.snapshot.json` |
| `nextly migrate` | Applies all pending migrations |
| `nextly migrate:fresh` | **Drops every table** and replays all migrations from scratch |
| `nextly migrate:resolve --applied <file>` | Marks a migration applied without running it (e.g. it was applied out-of-band) |

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
1. In `apps/playground/.env`, set the builder mode:
   - `NEXT_PUBLIC_NEXTLY_UI_SCHEMA_WRITE=0` → **database mode** (applies to the DB
     **and** writes `ui-schema.json` — the new dual-write).
   - `NEXT_PUBLIC_NEXTLY_UI_SCHEMA_WRITE=1` → **file mode** (writes
     `ui-schema.json` only, no DB change).
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

| Field type | Column |
|---|---|
| `text` / `email` / `select` / `radio` | `text` |
| `relationship` (single) | `text` (FK id) |
| `repeater` / `group` / `json` | `jsonb` |
| `checkbox` | `boolean` |
| `number` | `int4` (or `float8` if decimal) |
| `date` | `timestamp` |

Every table also gets `id`, `title`, `slug`, `created_at`, `updated_at`.

---

## 4. Known caveats (being worked on)

- **"Another schema operation holds the migrate lock."** The migrate lock leaks
  through Neon's PgBouncer pooler — a previous run can leave a stale lock that
  blocks the next `migrate`. **Workaround:** wait ~30s and retry, or make sure no
  dev server is running. (A pooler-safe lock + `--force-unlock` is the next thing
  being built.)
- **Database-mode + `migrate` on the *same* DB shows drift.** Database mode
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
