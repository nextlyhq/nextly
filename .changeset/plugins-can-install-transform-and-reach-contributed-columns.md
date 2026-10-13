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

Plugins can install and uninstall their schema, change other plugins'
entities, and reach the columns they contributed.

## Breaking changes

None for an existing app or plugin: everything here is new. Two behaviours to
know before using it:

- **A fully uninstalled plugin still listed in the config stops the boot**,
  in every environment, with `PLUGIN_SCHEMA_UNINSTALLED`. Run
  `nextly plugins install <name>` to reinstate it, or remove it from the
  config.
- **`onInstall` and `onUninstall` are called by the CLI, never at boot.**
  `nextly plugins install` calls `onInstall` after the plugin's migrations,
  and `nextly plugins uninstall` calls `onUninstall` before its DOWN
  migrations, with `{ keepData }`. Make both idempotent: an install can be
  retried after a failure part-way through.

## Added

- **`ctx.db.contributed(table, columns)`** (`@experimental`) reads and writes
  the columns a plugin contributed to a table it does not own, by row id, and
  names only those columns: `get`, `getMany` and `set`, with no insert, delete
  or free-form `where`. The app gets the same rule for the columns it
  contributed. A column on a core table arrives with the app's migrations;
  until it has, the call is refused with an error naming the column and the
  table.
- **`contributes.transforms`** (`@experimental`) lets a plugin change
  entities another plugin or the app declared, not only add fields to them.
  `setup(config)` runs before plugin schema contributions are merged and never
  sees them; transforms run after, in dependency order, each handed a frozen
  copy. A disabled plugin's transforms keep their storage changes and drop
  their behaviour.
- **`nextly plugins install` and `nextly plugins uninstall`** manage a
  plugin's schema, with the `onInstall` and `onUninstall` hooks
  (`@experimental`). Install applies the plugin's pending migration modules
  and refuses while a dependency is not installed
  (`PLUGIN_DEPENDENCY_NOT_INSTALLED`). Uninstall refuses while another
  enabled plugin depends on it (`PLUGIN_HAS_DEPENDENTS`) and when a migration
  cannot be undone (`PLUGIN_UNINSTALL_IRREVERSIBLE`), keeps the tables with
  `--keep-data`, and asks for `--yes` before dropping a table or running a
  DOWN that drops a column (`PLUGIN_UNINSTALL_UNCONFIRMED` without it). Each
  module's DOWN is read, judged and run the way `migrate:down --plugin` runs
  it. A development database whose plugin tables were pushed rather than
  migrated is refused, because there is no DOWN to run. To call `onInstall`
  or `onUninstall` the commands boot from the config as the app wrote it
  (`loadConfig` now also returns it, as `appConfig`), so a `setup`
  transformer that adds a plugin or a collection runs once and does not add
  it twice.

Full details: `docs/plugins/schema.mdx`, `docs/plugins/lifecycle.mdx`,
`docs/database/extending-the-schema.mdx` and
`docs/guides/production-migrations.mdx`.
