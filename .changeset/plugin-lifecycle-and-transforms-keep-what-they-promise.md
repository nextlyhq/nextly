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

Plugin uninstall, entity transforms and `ctx.db.contributed` keep what they
promise in more cases.

## Fixes

- **`nextly plugins uninstall` refuses while a disabled plugin requires the
  one being uninstalled** (`PLUGIN_HAS_DEPENDENTS`). A disabled plugin still
  takes part in schema ordering, so the uninstall could not have been
  finished: removing the plugin from the config would fail the boot.
- **An uninstall whose DOWN leaves one of the plugin's tables in place is not
  recorded as finished.** It stops with `PLUGIN_UNINSTALL_IRREVERSIBLE`
  (`tables-left-by-down`) and names the table, instead of marking the plugin
  uninstalled over it.
- **`nextly plugins install` and `uninstall` refuse a database `nextly
migrate` has not set up yet**, naming the command to run, instead of
  failing on a missing table part way through; the connection is released
  either way. Install's summary counts the tables it recorded, not owner
  rows.
- **The uninstall confirmation lists only elements on tables the plugin
  owns**, not other contributors' elements on a table it added an index to.
- **A transform receives copies of `Date`, `Map` and `Set` values**, so
  mutating one no longer changes the app's own configuration.
- **A disabled plugin's transform keeps keys named `access` in ordinary
  data**, such as a JSON default. Only entity and field access rules are put
  back.
- **`ctx.db.contributed` returns a column authored as `__proto__`** as an own
  property instead of dropping it.
