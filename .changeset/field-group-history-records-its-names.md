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

A project's migration history now records which names its field groups are kept under, and every migration command follows it. After `nextly migrate:field-groups --apply` moves a site's field groups to the current names, run `nextly migrate:create --field-group-names=current` once. It writes a migration with no statement whose snapshot is the history under the current names, and every later `migrate:create`, `migrate:check`, `migrate:baseline` and Schema Builder save plans against `fg_<slug>` tables instead of dropping them and creating `comp_<slug>` twins. `nextly migrate` records that migration on a database whose field groups moved and refuses it, naming the storage migration, on one that has not. A moved database behind a history that hasn't moved is refused by name instead of reported as missing every `comp_` table, and a plain `migrate:create` or Builder save across the two namings is refused before it writes anything.

A snapshot on the current names is written as version 2. Older Nextly CLIs refuse a snapshot version they don't know, so they stop with "upgrade your CLI" rather than read such a history as legacy. Upgrade the CLI in every environment before moving a project's history. Snapshots on the legacy names are written exactly as before.

`nextly migrate` and a production start's migrations also read each field group's stored table when they check translation columns, write a Schema Builder group's registry row, and compile a column the app or a plugin contributes to a group. The Schema Builder's address check names a new group's table under the site's names, as the create does.
