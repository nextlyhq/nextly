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
  builds, MySQL `LOCK TABLES`, SQLite `ATTACH`). In a file that runs in a
  transaction, its own `BEGIN`, `START TRANSACTION`, `COMMIT` and `END` are
  left out, and `SAVEPOINT`, `ROLLBACK TO` (also spelled `ROLLBACK WORK TO` or
  `ROLLBACK TRANSACTION TO`) and `RELEASE` run as written. **A pending file
  that uses a refused statement must be edited before it applies.** A file
  whose first line is `-- nextly:no-transaction`, or a plugin migration module
  with `transaction: false` (experimental), runs outside a transaction,
  statement by statement, so it can hold `VACUUM`, PostgreSQL's `CONCURRENTLY`
  index builds and the other statements a transaction refuses. Statements that
  leave state on the connection stay refused either way: a session `SET`, a
  bare `ROLLBACK`, MySQL `LOCK TABLES` and SQLite `ATTACH`. A unit marked to
  run outside a transaction is also refused, before anything runs, when it
  holds what needs one: its own `BEGIN`, `START TRANSACTION`, `COMMIT` or
  `END`, a savepoint, or PostgreSQL's `SET LOCAL`, `SET CONSTRAINTS` or
  `SET TRANSACTION` (refusal code `NEEDS_TRANSACTION_IN_MIGRATION`); on SQLite
  it may not write `PRAGMA foreign_keys` or `PRAGMA defer_foreign_keys`. Such
  a file has no all-or-nothing guarantee: if a statement fails, the ones
  before it stay applied and the run fails with
  `NEXTLY_MIGRATION_PARTIALLY_APPLIED`, whose message gives the statement
  count and the recovery (the database's own error is in its cause). While
  that failed attempt is the unit's newest, `nextly migrate` refuses to record
  the unit as applied without running it, even when the database already
  stands at its result: finish it by hand and mark it with
  `nextly migrate:resolve --applied <file>` (a file with no snapshot is
  recorded without comparing the live schema, and needs no `--skip-verify`,
  when it is marked, or on MySQL after a failed attempt; for a plugin module,
  `--failed-cleanup` and then `nextly migrate`), or reverse what ran, clear
  the attempt with `nextly migrate:resolve --failed-cleanup <file>` and
  migrate again. It is not run again over what stayed either, even when the
  database still stands at its start. `nextly migrate`, `migrate:down` and `migrate:status` name
  each unit that runs outside a transaction. A refusal's message names the
  marker, `migrate --dry-run` lists refusals, and `migrate:check` warns about
  them (`REFUSED_STATEMENT`). `nextly migrate:create --blank --no-transaction`
  writes a file whose first line is the marker, and
  `migrate:create --plugin <entry> --no-transaction` (or `--blank`) writes a
  module sealed with `migrationChecksum` when it loads, so its SQL can be
  edited. Existing plugin modules keep their checksums. On MySQL each schema
  statement still commits as it runs.
- **On SQLite a migration that leaves a dangling reference is refused.** Each
  unit runs with `foreign_keys` off, a `foreign_key_check` after its last
  statement and the setting restored afterwards, so a table rebuild keeps
  child rows. A unit that leaves a new dangling reference fails with
  `NEXTLY_MIGRATION_FOREIGN_KEY_VIOLATION`: a unit run in a transaction is
  rolled back; one marked to run outside a transaction keeps its statements
  and is recorded as failed, to be repaired and then marked applied.
- **A large body on an auth request carrying the refresh cookie is refused.**
  Before an auth hook, a strategy or a plugin route sees a request that
  carries the refresh cookie (any `/admin/api/auth/*` request from a signed-in
  browser), the cookie is removed from a copy of the request, and that copy
  now reads at most 64 KiB of the body, the same cap as the `csrf` route
  option's reader. A larger body is refused with a `400` `VALIDATION_ERROR`
  response (`too_large`) before authentication and rate limiting, instead of
  being buffered whole.
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

- **An app migration that drops or renames a core table is refused.** Core
  tables (`users`, `media`, …) are core's. An app migration may still drop or
  rename any column of a core table that no plugin's records name as its own,
  since a column the app contributed cannot be told apart from core's.
- **A plugin's migration modules must have unique names**, including names
  that differ only in case, since a module's name is its key in the
  migration ledger. A module name may not contain `/`, and each module's
  `schemaVersion` must be a positive integer, whether or not the plugin
  declares one. When the plugin declares a `schemaVersion`, no module's may be
  lower than the one before it in name order, and the last must equal it.
  Each is refused when the configuration loads, before any migration runs.
  Modules run in name order compared character by character after
  lowercasing, without the host's locale, so a plugin's modules run in the
  same order on every machine (`10_more` before `1_init`: zero-pad numbered
  names).
- **On MySQL, a failed migration attempt is never adopted.** MySQL commits
  each schema statement as it runs, even inside a transaction, so a
  migration whose data statement failed after its schema statements could be
  recorded as applied on retry with that data change skipped. While a
  migration's newest attempt is a failed one, `nextly migrate` on MySQL
  refuses it with `NEXTLY_MIGRATION_PARTIALLY_APPLIED` and names the
  recovery. PostgreSQL and SQLite run it again as before.
- **On MySQL, a failed migration attempt is never run again either.** MySQL
  also commits what ran before a schema statement, so a migration whose
  schema statement failed after a data statement left the data change applied
  while the schema still matches its start, and a retry repeated it. While
  its newest attempt is a failed one, `nextly migrate` refuses to run it with
  `NEXTLY_MIGRATION_PARTIALLY_APPLIED`, with or without a snapshot, as it does
  on every dialect for a unit marked to run outside a transaction. After
  fixing a failed MySQL migration, clear the attempt with
  `nextly migrate:resolve --failed-cleanup <file>` before running it again.
- **An explicit collection index `name` must start with `idx_` or `uq_`.**
  Those are the only names schema changes drop, so an index named otherwise
  would be created and never removed once its declaration was. A collection
  declaring `{ fields: ["slug", "locale"], unique: true, name: "slug_locale_unique" }`
  is refused by `defineCollection` with the rename to make; use
  `name: "uq_slug_locale"`, or leave `name` out to have one derived. No
  database carries an index under the old name, because collection indexes
  were not created before this release.
- **Virtual fields are not validated on write.** A virtual field's value is
  dropped before the write, so `required` and `validate` on it no longer
  refuse a create or update that omits it or sends a value.
- **`defineTable` refuses a decimal scale above 30** (MySQL's maximum) and a
  foreign key over no columns, `col.varchar(n)` refuses a width above 16,383
  characters (the widest MySQL declares under utf8mb4), and two relations of
  one name on a table are refused. When the schema compiles, a table whose
  columns do not fit MySQL's 65,535-byte row is refused on every dialect, and
  so are two foreign keys that resolve to one name across the tables plugins
  and the app declare, since MySQL requires a foreign key's name to be unique
  per database.
- **A declared collection index is checked on every dialect** when the
  schema is built from the config (development push, `db:sync`,
  `migrate:create`). A JSON field or an unbounded text field (a textarea, say)
  cannot be part of one; its whole key may not exceed MySQL's 3,072 bytes,
  where a text field counts 4 bytes for each character of its width (1,020 at
  the default 255), so an index over four text fields is refused; and an
  explicit `name` may be at most 63 characters, the longest PostgreSQL keeps.

## Schema

A plugin declares tables in `contributes.schema` with a dialect-neutral DSL
(`defineTable`, `col.*`), or through hooks that run in dependency order and
see every table already declared. `col.enum()` enforces its values with a
check constraint on every dialect, and `col.serial()` declares a
database-assigned key, which must be the table's primary key. A collection can
choose `db.idType` between random and time-ordered UUIDs, and accept a
client-supplied id with `db.allowIdOnCreate`.

Ownership is recorded per table and per element, and a migration is refused
before it runs (`DROP_OF_FOREIGN_TABLE`) if it drops or renames a table or a
column another owner holds. A table with no owner record (every collection,
Single and component table, and tables your own migrations created) is the
app's to drop and never a plugin's: a plugin migration may drop only tables
its records name, or a table the same module creates that did not exist
before the module ran, created and dropped under one unqualified, lower-case
name (`CREATE TABLE t`, not `scratch.t` or `"T"`; SQLite's `temp.t` counts).
A `CREATE` of a table that already exists earns nothing, and a module that
runs a PostgreSQL `SET`, `RESET`, `DISCARD`, `set_config()`, `CREATE SCHEMA`
or `ALTER SCHEMA`, or a MySQL `USE`, earns nothing for any table it creates.
MariaDB's `CREATE OR REPLACE TABLE t` is read as a drop of `t`, unless no
table `t` existed before the module ran, and then as its creation. On
PostgreSQL, a `CREATE FUNCTION` or `CREATE PROCEDURE` whose body is a quoted
string rather than `$$`-quoted is refused, as a `DO` with one is, and so is
`CASCADE` on a `DROP` of anything but a table (a type, domain, extension,
function, view, sequence or index), which also drops whatever depends on it:
drop the dependents first, then the object without `CASCADE`. On SQLite, a
table rebuild that removes a column (how a column carrying a check, such as an
enum, is removed) is judged as that column's drop, so the app may remove an
enum it added to `users`. Dev push never drops a table no record claims. A
plugin whose table, or column, index, foreign key or check, is recorded as
another owner's is refused (`CONFLICT`) rather than taking it over; delete the
old owner's rows from `nextly_schema_owners` if it is meant to pass to it.
Schema pushes never run a `DROP SCHEMA`.

`nextly migrate:create --plugin <name>` generates a plugin's migration
modules for all three dialects. `nextly migrate` applies them with the app's
own files and counts both in its summary.

The DSL and the types a generated migration module imports are exported from
the new `@nextlyhq/plugin-sdk/schema` subpath (`@experimental`): `col`,
`defineTable`, `migrationChecksum`, `PluginMigration` and the schema hook and
table types.

A collection, Single or component field can be `virtual`: it gets no column,
a value sent for it on create or update is dropped before the write, and its
value is computed in an `afterRead` hook.

## Fixes

The admin loads again for a signed-in user. Removing the refresh cookie from
the request handed to auth hooks, strategies and plugin routes copied the
request with the global `Request` constructor, which cannot read the instance
Next.js passes in, so every session check from a browser holding the refresh
cookie failed with a server error. The copy is now built from the request's
URL, method, headers and body.

`nextly db:sync` (and `--watch`) now creates the tables plugins declare and
the columns and indexes plugins or the app contribute to entity tables, and
no longer plans to drop a contributed column it finds in the database.
`nextly migrate` counts the plugin migrations it applied in its summary,
applies a plugin's migrations on a database the app already migrated, and
adopts a multi-module history that development push already created.
`migrate:create --plugin` accepts a plugin exported by name, and reports no
changes (exit 2) when the plugin's schema matches its last migration.
`migrate:create --plugin --blank` now writes a blank module; before, `--blank`
was ignored with `--plugin`. `migrate:create --plugin` never overwrites a
module file that already exists: it fails with `CONFLICT` and leaves the
module and the barrel as they were. `nextly migrate --step N` counts a plugin's
modules toward N together with the app's files, the plugin's first, and a
module recorded because the database already stood at its result counts as
one. `migrate:resolve --failed-cleanup` clears every
failed attempt since the file's last other event, and `--applied` supersedes
them all, so a file that failed twice in a row needs one cleanup rather than
two. A cleared attempt keeps its own start and end times and its error;
before, the cleanup overwrote its end time with the time of the cleanup. `migrate:resolve --applied plugin:…` now refuses,
naming `--failed-cleanup` and then `nextly migrate`, instead of reporting the
module's file missing.

In development, a plugin's existing tables gain the columns, indexes and
constraints its upgraded declaration added before its `init` runs, so an
`init` reading a new column no longer fails the boot. Changes that need a
decision (drops, type or nullability changes, renames, a NOT NULL column
without a default) stay with the development push and its prompts.

`nextly migrate` records a plugin's table ownership again when its last
migration is applied but the owner rows were never written, for example
after a run that stopped between the two. A production boot no longer
refuses a plugin whose migrations only change data: its applied schema
version is read from the migration ledger. `migrate:status --plugin <name>`
lists the modules the plugin ships, so one that has not run yet shows as
pending. `migrate:down` rolls back migrations recorded in the same
millisecond in reverse run order.

A hidden contributed column cannot be a group key and is ignored as a sort
key, so a grouped read cannot publish its values as bucket labels. A `where`
naming one, in either spelling and at any depth, is refused with
`FIELD_NOT_FILTERABLE` for every caller, so a filter cannot probe its values;
that includes a column contributed to a component's table, named under the
component field (`seo.searchVector`). When
startup fails while several requests wait for it, only one retries. The
PostgreSQL adapter no longer runs `CREATE SCHEMA` for a schema that already
exists, so a role without database-level CREATE can connect with
`schema: "public"`.

Full details: `docs/database/extending-the-schema.mdx`,
`docs/plugins/schema.mdx` and `docs/guides/production-migrations.mdx`.
