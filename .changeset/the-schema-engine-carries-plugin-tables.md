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

Plugins and apps can declare their own tables, and plugins ship the
migrations that carry them to production. The signed-in admin loads again.

## Upgrading

**Run `nextly migrate` before deploying this release**, and edit any pending
migration file the run refuses (see below). Applied files are never re-read.

## Breaking changes

- **Pending migrations run before plugins initialise.** They used to run after
  plugin `init`, so a plugin queried a database whose migrations had not been
  applied. A plugin that relied on running first, for example to prepare
  something a migration reads, now runs after the migrations.
- **Plugin routes and widget sources are checked before migrating.** A route
  with a method outside `GET`, `POST`, `PATCH`, `PUT` and `DELETE` (such as a
  JavaScript plugin's lowercase `"post"`), or a reserved widget source id,
  stops the boot before the database is migrated. A route with such a method
  used to be registered where no request could reach it.
- **Each migration file runs whole.** Every app migration file, plugin
  migration module and DOWN runs in one transaction on one connection, split
  into statements by a dialect-aware scanner that keeps `DO $$`, trigger and
  routine bodies whole. A file is refused before anything runs when it holds a
  statement that would end or hand off that transaction (`ROLLBACK`, `ABORT`,
  `XA …`, prepared transactions), a PostgreSQL session setting that would
  outlive it on a pooled connection (`SET` other than `SET LOCAL`,
  `SET CONSTRAINTS` and `SET TRANSACTION`, `RESET`, `DISCARD`), or a statement
  the database cannot run inside a transaction (`VACUUM`, `CONCURRENTLY` index
  builds, MySQL `LOCK TABLES`, SQLite `ATTACH`). `BEGIN` and `COMMIT` in a file
  are left out; `SAVEPOINT`, `ROLLBACK TO` and `RELEASE` run as written. **A
  pending file that uses a refused statement must be edited before it
  applies**, or marked with a `-- nextly:no-transaction` comment, which runs it
  statement by statement outside a transaction, with no all-or-nothing
  guarantee; the run's output says so. On MySQL each schema statement still
  commits as it runs.
- **On SQLite a migration that leaves a dangling reference is rolled back.**
  Each unit runs with `foreign_keys` off and a `foreign_key_check` before it
  commits, so a table rebuild keeps child rows, and a unit that leaves a new
  dangling reference fails with `NEXTLY_MIGRATION_FOREIGN_KEY_VIOLATION`.
- **Collection `indexes` now reach the database.** They were validated and
  then discarded, so an app that declared a compound index has been running
  without one. The next dev push or `migrate:create` adds it, and a unique
  index over columns that already hold duplicate rows fails to build until the
  duplicates are resolved:

  ```sql
  SELECT country, city, COUNT(*)
  FROM dc_places
  GROUP BY country, city
  HAVING COUNT(*) > 1;
  ```

- **What the schema model cannot carry is refused rather than lost**: partial
  (`where`) indexes on every dialect, because MySQL has none; expression index
  keys carrying an ordering, collation or operator class; check constraints,
  foreign keys and enums where the diff cannot see them; and anything an app's
  `db.schema.afterDrizzle` hook returns that would not survive the round trip.
- **`db.postgres.schema` accepts only `"public"`.** Any other value stops the
  boot and every CLI command, because the schema push cannot yet create tables
  outside `public`. MySQL and SQLite warn and ignore it.
- **A plugin's migrations are checked at boot and by `nextly migrate`.** A
  production boot refuses a plugin whose `schemaVersion` is ahead of the
  modules the database has applied (`PLUGIN_SCHEMA_BEHIND`): run
  `nextly migrate`. `nextly migrate` refuses a plugin that declares tables or
  contributed columns but ships no migration modules
  (`PLUGIN_MIGRATIONS_UNAVAILABLE`). A disabled plugin's migrations still run,
  and its tables stay.
- **`nextly migrate:create --plugin` never drops what the plugin created.** It
  cannot tell a renamed table or column from a drop and an add, so a generated
  drop of anything the plugin's earlier modules created is refused with
  `PLUGIN_MIGRATION_DROPS_CREATED_SCHEMA`, naming each, and the command fails; write the
  rename, or the deliberate drop, by hand. With no schema changes it writes
  nothing and exits with code 2, whatever `schemaVersion` says, so a CI step
  that asks whether shipped modules are current must treat 2 as "up to date".
- **A column contributed to a table you do not own now arrives.**
  `extendTable({ columns })` on a collection, Single or extendable core table
  (`users`, `media`, `nextly_jobs`, `audit_log`, `activity_log`) used to be
  validated and then dropped. It is now created by the app's migrations, so
  the next `migrate:create` adds it, and it is stripped from every entry the
  API returns.

## Schema

A plugin declares tables in `contributes.schema` with a dialect-neutral DSL
(`defineTable`, `col.*`), or through hooks that run in dependency order and
see every table already declared. `col.enum()` enforces its values with a
check constraint on every dialect, and `col.serial()` declares a
database-assigned key, which must be the table's primary key. A collection can
choose `db.idType` between random and time-ordered UUIDs, and accept a
client-supplied id with `db.allowIdOnCreate`.

Ownership is recorded per table and per element, so no path drops a table or
a column on behalf of an owner that does not own it, and a table with no owner
record is never dropped. Schema pushes never run a `DROP SCHEMA`.

`nextly migrate:create --plugin <name>` generates a plugin's migration
modules for all three dialects. `nextly migrate` applies them with the app's
own files and counts both in its summary.

## Fixes

The admin loads again for a signed-in user. Removing the refresh cookie from
the request handed to auth hooks, strategies and plugin routes copied the
request with the global `Request` constructor, which cannot read the instance
Next.js passes in, so every session check from a browser holding the refresh
cookie failed with a server error. The copy is now built from the request's
URL, method, headers and body.

Full details: `docs/database/extending-the-schema.mdx`,
`docs/plugins/schema.mdx` and `docs/guides/production-migrations.mdx`.
