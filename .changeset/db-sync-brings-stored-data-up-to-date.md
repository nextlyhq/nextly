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

`nextly db:sync` now brings the data an earlier release stored up to date, as `nextly migrate` does, so a development database that has no migrations is not left behind. Once it has synced, it hashes passwords stored before this release, removes passwords kept in version history, and converts roles holding a retired `manage-` permission, under the schema lock.

The steps rewrite stored values, so a run with work needs a backup confirmed: pass the new `--backup-confirmed`, or answer yes when it asks at a terminal. With no terminal and no flag it stops with `DATA_STEPS_BACKUP_NOT_CONFIRMED` before the sync changes anything. A database with nothing of the kind is never asked, and the flag is ignored there. `nextly db:sync --dry-run` lists each step with work and its count. With `--watch` the steps are taken once, after the first sync.

The start warning for a role holding a retired manage permission now names both commands: `nextly migrate`, or `nextly db:sync` in development.
