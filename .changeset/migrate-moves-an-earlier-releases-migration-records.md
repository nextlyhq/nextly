---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

`nextly migrate` now moves the migration records of an earlier release itself. A database from an early alpha keeps them in `nextly_migrations` and `nextly_migration_journal`; `nextly migrate` used to refuse it and send you to `nextly upgrade`. It now copies the records into `nextly_schema_events` and drops both tables, holding the schema lock for the whole move, and carries on with the pending migrations in the same run.

It does this only once a backup is confirmed: pass `--backup-confirmed`, or answer yes when it asks at a terminal. With no terminal and no flag it changes nothing and stops with `MIGRATE_BACKUP_NOT_CONFIRMED`; a no at the prompt stops it with `MIGRATE_BACKUP_DECLINED`. The flag is ignored on a database with no such records, so a deploy script can always pass it. `--confirm-backed-up` is accepted as `--backup-confirmed` for one release, with a notice. `nextly migrate --dry-run` on such a database lists the move and stops there.

**Compatibility: `nextly upgrade` no longer moves these records.** On a database that still has the legacy tables it changes nothing and names `nextly migrate --backup-confirmed`; run `nextly migrate` first, then `nextly upgrade`, whose other steps and `--reconcile-core` are unchanged. `nextly upgrade --target-table-name` no longer does anything and says so: a table of another shape already named `nextly_schema_events` is refused, and the fix is to rename it. The refusals of `migrate:baseline` and the other commands that need the history name `nextly migrate --backup-confirmed` too.
