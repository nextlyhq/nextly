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
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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
"create-nextly-app": patch
"nextly": patch
---

Schema changes now take one lock per database, the schema lock, renewed while it is held. `nextly migrate` and the boot migrate step, `migrate:down`, `migrate:baseline`, `migrate:resolve`, `upgrade`, plugin install and uninstall, `migrate:field-groups --apply`, `db:sync`, the development push and the Single and field-group Schema Builder saves all hold it for the whole of their work, so none of them runs beside another, and SQLite gains a real lock: a development server and a command-line run on one SQLite file now exclude each other. A run of any length keeps the lock; one that dies lets it lapse within one lease (`db.migrateLockTtlSeconds`, now 120 seconds by default), with nobody clearing it by hand. A command-line run that finds the lock held waits about a minute and then stops without changing anything, naming the command that holds it, when it started and when the lock lapses if that holder has gone; a Schema Builder save is refused at once and asks you to save again once the migration ends; a production start with `runMigrationsOnBoot` refuses to start rather than serve. A command releases the lock however it ends, on an interrupt too.

While an upgrade is rolled out, the earlier `nextly_migrate_lock` (and MySQL's named migrate lock) and `nextly_field_group_lock` are honoured and held beside the new lock, so a process of an earlier version is still excluded. A path that took no lock in an earlier version cannot see the new one — on SQLite, an earlier `nextly migrate`; on every dialect, a Collection Builder save, `migrate:fresh`, `prune` and the development start's registry sync — so stop processes of earlier versions before the first run of this one.
