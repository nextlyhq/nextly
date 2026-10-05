---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Plugins and apps can extend the database schema.

A plugin declares tables with a dialect-neutral DSL, or through hooks that run
in dependency order and see every table already declared. What it declares is
typed without a codegen step, reached through an owner-checked `ctx.db`, and
carried to production by migrations the plugin ships itself.

**Collection `indexes` now reach the database.** They have been validated and
then discarded since the option was introduced, so an app that declared a
compound index has been running without one. The next dev push or
`migrate:create` will add it — and a unique index over columns that already
hold duplicate rows will fail to build until the duplicates are resolved:

```sql
SELECT country, city, COUNT(*)
FROM dc_places
GROUP BY country, city
HAVING COUNT(*) > 1;
```

**Pending migrations now run before plugins initialise.** They used to run
after, so a plugin's `init()` hook queried a database whose migrations had not
been applied. On an upgraded database that meant writing to a column that did
not exist yet.

What the schema model cannot carry into migrations and drift detection is
REFUSED rather than lost: partial (`where`) indexes on every dialect, because
MySQL has none; expression index keys carrying an ordering, collation or
operator class, which no dialect reports back; check constraints, foreign keys
and enums where the diff cannot see them; and anything an app's `afterDrizzle`
hook returns that would not survive the round trip. A constraint that exists on one machine and no deployment is
worse than one that does not exist at all.

Ownership is recorded per table and per element, so no path drops a table — or
a column — on behalf of an owner that does not own it. A table with no owner
record is never dropped by anything.

`nextly plugins install` and `nextly plugins uninstall` manage a plugin's
schema. Install refuses while a dependency is not installed; uninstall has
`--keep-data`, a refusal while another plugin depends on it, and a refusal
when a migration cannot be undone. Uninstall asks for confirmation, and
`--yes` gives it where there is no terminal; a development database whose plugin
tables were pushed rather than migrated is refused, because there is no DOWN to
run.

**A column contributed to a table you do not own now arrives.**
`extendTable({ columns })` validated the column, marked it hidden and recorded
who contributed it, then reached nothing: no table spec, so it was never
created, and no runtime table, so `ctx.db` could not have used it. It now
reaches the desired spec, the runtime table and the schema fingerprint, and is
stripped from every entry the API returns — a column on the table is a column
`select()` returns, and this one is no field of the entity.

**`ctx.db.contributed(table, columns)`** reads and writes the columns a plugin
contributed to a table it does not own, by row id, and names only those
columns. A column on a core table arrives with the app's migrations; until it
has, the call is refused with an error naming the column and the table.

**`contributes.transforms`** lets a plugin change entities another plugin
declared, not only add fields to them. `setup(config)` runs before plugin
schema contributions are merged and never sees them; transforms run after, in
dependency order, each handed a frozen copy.

**`db.postgres.schema`** is reserved for placing an installation in its own
PostgreSQL schema, and accepts only `"public"` for now: any other value is
refused at boot and by every CLI command, because the schema push cannot yet
create tables outside `public`. MySQL and SQLite warn and ignore it. Schema
pushes never run a `DROP SCHEMA`, whatever drizzle-kit emits.

**`col.enum()` enforces its values** through a check constraint — the one
mechanism all three dialects have — and `col.serial()` declares a
database-assigned key. A collection can choose `db.idType` between random and
time-ordered UUIDs, and accept a client-supplied id with
`db.allowIdOnCreate`.

**Migration files run as one unit.** Each file, plugin module or DOWN runs in
one transaction on one connection, split into statements by a dialect-aware
scanner that keeps `DO $$` bodies and trigger and routine bodies whole. A file
is refused before anything runs when it holds a statement that would end or
split that transaction, a session setting that would outlive it on a pooled
connection, or a statement the database cannot run inside a transaction
(`VACUUM`, `CONCURRENTLY` index builds, MySQL `LOCK TABLES`, SQLite `ATTACH`).
On SQLite each unit runs with `foreign_keys` off and a `foreign_key_check`
before commit, so a table rebuild keeps child rows, and a unit that leaves a
new dangling reference is rolled back with
`NEXTLY_MIGRATION_FOREIGN_KEY_VIOLATION`. A pending file that relied on a
refused statement has to be edited before it applies; applied files are never
re-read.

Full details: `docs/plugins/schema.mdx`, `docs/database/extending-the-schema.mdx`
and `docs/guides/production-migrations.mdx`.

**BREAKING — `ctx.db` is no longer the Drizzle instance.** It is now the
owner-checked surface, and the four verbs it shares with Drizzle take
different arguments: `ctx.db.select(myTable)` where you wrote
`ctx.db.select().from(myTable)`. Both shapes cannot live on one object,
because the names collide, so this is a break rather than an addition.

The unchanged Drizzle handle is still there, as `ctx.db.raw`. The smallest
migration is mechanical:

```ts
// before
await ctx.db.select().from(rows).where(eq(rows.id, id));
// after — unchanged behaviour, one property deeper
await ctx.db.raw.select().from(rows).where(eq(rows.id, id));
// or, owner-checked and portable across all three dialects
await ctx.db
  .select(rows)
  .where(eq(ctx.db.table(rows).id, id))
  .first();
```

A call written against the old shape does not fail obscurely: it is refused
by name, saying what changed and where the old handle went.
