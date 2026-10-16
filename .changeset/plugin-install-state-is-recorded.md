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
---

Every plugin now has a recorded install state, a production boot refuses a
configured plugin that was never installed, and an uninstall that stopped
part way is finished by running it again.

## Compatibility

Upgrading a production deployment needs one step first: run
`nextly plugins install <name>` once for each configured plugin on that
database, before the new version boots. Until then a production boot refuses
the plugin.

## Changes in behaviour

- **A production boot refuses a configured plugin until `nextly plugins
install` has run for it on that database** (`PLUGIN_NOT_INSTALLED`),
  whether or not migrations run at boot. `nextly migrate` applies a plugin's
  modules but never runs its `onInstall`, so it does not install the
  plugin. Development warns instead. **Existing databases have no install
  record yet: before upgrading a production deployment, run
  `nextly plugins install <name>` once for each configured plugin.**
- **After an uninstall, with or without `--keep-data`, the boot refuses the
  plugin while it is still configured, in every environment**
  (`PLUGIN_SCHEMA_UNINSTALLED`). An uninstall with `--keep-data` used to let
  the plugin boot over the tables it left.

## Fixes

- **Installing a plugin is refused while a dependency was never installed
  by the install command, was uninstalled, or has an uninstall that did not
  finish** (`PLUGIN_DEPENDENCY_NOT_INSTALLED`), including a dependency that
  owns no schema. Such a dependency used to count as installed.
- **`nextly plugins install` and `uninstall` record the plugin's state** as a
  `plugin_lifecycle` event in the migration ledger, so a plugin that owns no
  table has one too. No schema change: the ledger already holds any event
  type.
- **An uninstall records that it has begun before its first change.** If it
  stops part way, the boot refuses the plugin (`PLUGIN_UNINSTALL_UNFINISHED`)
  until the uninstall is run again the same way, which plans over what is
  left and finishes. Run the other way, with or without `--keep-data`, it is
  refused.
- **The install-state refusals come before boot migrations**, so a refused
  plugin's modules, or a half-uninstalled one's rolled-back modules, are not
  applied first.
- **On MySQL, the migrate lock is held on one connection for the whole
  migration.** The lock and its release used to run on whichever pooled
  connection was free, so a release on another connection left the lock held
  until that connection closed.
