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

`nextly migrate` now records what it created, so a collection built in the
Schema Builder and deployed to production shows its dashboard cards.

It did not before. `registerFromMigrations` is the only writer that records
`applied`, and its one caller sits inside `runBootTimeApplyIfDev`, whose first
line returns unless `NODE_ENV === "development"`. The CLI applied the DDL and
touched no registry row at all, so the row stayed `pending` after its table
existed — and a restart re-ran the same dev-gated path and changed nothing.

A third phase now runs after the file migrations, inside the migrate lock. It
registers what the snapshots describe, then moves every pending row whose table
actually exists to `applied`. A row whose table is NOT there is left exactly as
it was: after a migrate run, that has two indistinguishable causes — a migration
that failed, and one that was never generated — and marking the second `failed`
would turn a collection still waiting for its DDL into one somebody has to
repair by hand. The pass runs on every invocation, so a row that misses one run
is picked up by the next.

The command still succeeds if the bookkeeping fails. By then the DDL has landed,
and MySQL commits DDL implicitly, so there is no transaction to roll back into;
failing would report a migration that worked as broken.

`getRecordsWithPendingMigrations` was broken and could not have worked for
anyone. It filtered on `migration_status` and ordered by `created_at` — physical
column names — while the adapter resolves columns by their Drizzle property
names, so it threw "Column not found in table" for every caller. It had no
callers, which is why nothing surfaced it: it was written for a reconciliation
pass that was never wired up.

Three sibling queries in the same base service carried the same mistake and are
fixed with it: two `orderBy` clauses naming `created_at`, which an adapter does
not reject — it ignores them, so the caller believed it had asked for an order
it never got — and one `migrationStatus` filter that would have thrown for
anyone who passed it. The three list paths now share one reader, so a method
cannot be written that skips the ordering, the deserialization or the error
mapping while looking correct beside the others.
