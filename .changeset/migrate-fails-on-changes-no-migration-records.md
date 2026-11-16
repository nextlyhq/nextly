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

**Changes not yet in a migration fail `nextly migrate`.** Before it changes anything, `nextly migrate` now compares the configuration (with plugins and Schema Builder entities) with the newest snapshot in the migrations folder. A collection, Single, field group or field added, removed or changed in its storage, a settings change, or an app or plugin permission added or removed, with no migration written, fails the run with `SCHEMA_DRIFT` (or `SETTINGS_CHANGE_WITHOUT_MIGRATION` for settings alone). Every change is listed, with `nextly migrate:create` as the fix. It never again reports "Database is up to date" on an empty database with no migration files. The same check runs in `nextly migrate --dry-run`, in `migrate:check` (which now also names permission changes), in `migrate:fresh` before it drops anything, and at a production start with `db.runMigrationsOnBoot`, which refuses to start. It applies in development too. Where the database already holds the tables and no migration exists yet (a project made with `db:sync`), the message also says to run `nextly migrate:baseline` first.

**A database that lacks what its migrations made fails `nextly migrate`.** A table or column the newest applied migration's snapshot records but the database lacks fails the run with the new `DATABASE_BEHIND_MIGRATIONS` code, naming each one and the migration that last created it, with nothing changed. A table or column a later migration dropped is not missing.

**First deploy after upgrading.** A site whose newest snapshot predates recorded settings and permissions is not stopped for them: its first run records them in the database and prints one notice that the next `nextly migrate:create` writes the migration that captures them. Later runs compare with what that run recorded, until the first `migrate:create` writes them into a snapshot.
