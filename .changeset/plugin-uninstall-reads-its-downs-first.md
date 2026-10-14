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

A plugin uninstall whose DOWNs would leave a table is refused before
anything runs, and a disabled plugin's transform keeps access rules at
every level of an entity's schema.

## Fixes

- **`nextly plugins uninstall` reads the DOWN statements before running
  any**, in the order they will run, and refuses a full uninstall that
  would leave one of the plugin's tables in place
  (`PLUGIN_UNINSTALL_IRREVERSIBLE`, `down-leaves-tables`), naming the table.
  Each table is followed through renames: one a SQLite rebuild drops and
  renames back, one renamed away and kept, or one whose name another table
  takes after its drop, counts as left. Only the statements a generated DOWN
  is made of are read; a DOWN holding anything else (a savepoint, a
  procedural block, a view, a temporary table, a schema-qualified name) is
  refused, as is an uninstall whose `onUninstall` dropped or renamed one of
  the tables the DOWNs were to drop. Every module stays recorded
  as applied, so the ledger still says what the plugin's schema is. Before,
  this was found only after the DOWNs had run and recorded each module
  rolled back, and the next uninstall stopped on `no-applied-module`.
- **A table still there after the DOWNs ran** keeps the plugin from being
  recorded uninstalled (`tables-left-by-down`), as before; dropping the
  table and running the uninstall again now finishes it, and the message
  says so.
- **A disabled plugin's transform keeps access rules wherever they sit in
  an entity's schema**, not only on the entity and on items of `fields` and
  `blocks` lists. A key named `access` under a free-form value — a field's
  `defaultValue`, `custom`, `pluginOptions`, `jsonSchema`, `filterOptions`,
  `sortOptions` or `admin.style`, or any option of a plugin's own field type
  — is data, and merges like any other key. A field the transform moves to
  another group or tab keeps its access rule.
