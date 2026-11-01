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

A change to settings alone now reaches production. When only a collection's, Single's or field group's settings change (labels, description, icon, sidebar group and other admin options, versioning, Draft/Published, the localisation flag, or a field's help text, placeholder or hidden flag), in code or in the Schema Builder, `nextly migrate:create` writes a migration with no table statements that names each entity and what changed (`-- Settings: posts: description`), with its snapshot. A migration that changes columns also names every settings change since the previous snapshot, a cleared setting counts as a change, and a Builder entity's registry row travels with its settings change. Site content settings (general settings, the email setup) never appear in a migration.

Every snapshot `migrate:create` writes now records every entity's settings. Snapshots written before this release carry none and are read as saying nothing about them, so the first `migrate:create` after upgrading writes one settings-only migration that records every entity's settings (`-- Settings: posts: settings recorded`).

`nextly migrate` now refuses a pending migration file the Schema Builder wrote with no snapshot beside it (a `<timestamp>_create_<slug>.sql`, `_update_`, `_drop_`, `_i18n_` or `_status_` file), where it used to apply it as written. It stops before changing anything, names the file, and says to replace it with the migration `nextly migrate:create` writes for that change. `nextly migrate:check` names the same file and remedy.
