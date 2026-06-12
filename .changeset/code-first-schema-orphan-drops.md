---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/ui": patch
---

Fix code-first / HMR schema applies wrongly dropping managed tables on SQLite & MySQL.

On SQLite and MySQL, drizzle-kit's `pushSchema` ignores `tablesFilter` and introspects the whole database, so any managed table missing from the desired schema was flagged as a data-losing "orphan" DROP — failing the apply and offering the table as a spurious rename source. Three cases are fixed:

- **Schema-events ledger (`nextly_schema_events`)** is now a first-class managed core table (declared in `getCoreSchema` / `getDialectTables` / `CORE_TABLE_NAMES`), so no schema path — apply, HMR, `migrate`, or `db:sync` — ever treats it as an orphan drop or offers it as a spurious rename target. To make it round-trip cleanly, the SQLite primary key gains an explicit `NOT NULL` (SQLite, unlike PG/MySQL, treats a bare `TEXT PRIMARY KEY` as nullable) and the SQLite partial unique index is dropped — drizzle-kit 0.31.10 cannot round-trip a SQLite partial index ([drizzle-team/drizzle-orm#4688](https://github.com/drizzle-team/drizzle-orm/issues/4688)), and keeping it churned `DROP/CREATE INDEX` on every push. Postgres keeps its partial unique index. The "one applied row per file" guarantee is now enforced in code on all dialects: an atomic conditional `markApplied` (sets `applied` only when no other applied row exists for the filename) plus the existing cross-process migrate lock.
- **UI-created collections, singles, and components** are now preserved during a code-first HMR apply: every DB-registered resource is included in the desired schema (code-config entries take precedence), so adding a collection in code no longer drops resources created via the admin UI.
- **Migration status**: a collection added in code after the initial DB setup is now marked `applied` once its table is created, instead of showing `pending` forever in the builder listing (mirrors the existing singles behaviour).
