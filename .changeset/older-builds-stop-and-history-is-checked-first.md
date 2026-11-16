---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
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

An older build stops instead of calling the database up to date, and every command that changes migration history checks it first.

**Compatibility: older builds stop, from this version on.** A build whose migrations folder lacks an app migration the database records applied now stops with exit code 3 (`MIGRATION_MISSING`), naming each missing migration, before it changes anything, core tables included. Before, it printed "Nothing to migrate. Database is up to date." Stop every build released before this check, preview deployments that share production's database included, before the first `nextly migrate` of this version. A migration the folder lacks that a newer build tried and did not finish stops the run the same way.

**Compatibility: history is checked by every command that changes it.** `nextly migrate` and the boot migrate step, `migrate:down`, `migrate:baseline` and `nextly upgrade --reconcile-core` each check, before their first write, for an applied migration the folder lacks (exit 3), an unresolved attempt, and an applied file edited since it ran (exit 2). `migrate:resolve` and `migrate:fresh` are exempt. A plugin's modules are never counted as app migrations. `nextly upgrade --reconcile-core` now loads the config, as `nextly migrate` does, to find the migrations folder.

`nextly migrate:resolve --removed <file>` records an applied migration's file removed on purpose: the migration stays applied, later runs go on, and if the file returns it is never run again and is checked against its recorded checksum. `migrate:down` refuses to roll it back while its file is absent, and `nextly migrate:status` lists it with a new status, `applied (file removed)` (in `--json` too), as information rather than the `applied (file missing)` problem. `nextly migrate:resolve --rolled-back <file> --file-missing` records a migration rolled back whose file is gone, an attempt a newer build left unfinished included; without the flag, `--rolled-back` still needs the file.
