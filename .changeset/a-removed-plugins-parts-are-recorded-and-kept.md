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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

`nextly migrate`, and a production start that runs migrations, now record who added each hidden column, index and check on a collection's, Single's, field group's or core table, as a development push records it. A database set up by migrations alone therefore knows which parts a plugin built, and once that plugin leaves the configuration, a change that would take one of them is refused before anything runs, naming the plugin, the element and its table, as it already was on a database a push set up. A database migrated before this release gets the record at its next `nextly migrate`, with no pending migration needed; a plugin already gone from the configuration by then gets none.

A plugin no longer in the configuration never counts as removing its own parts with the app's change: a Schema Builder save, a development push, `nextly migrate:create` or `nextly migrate` that would drop its column's index with the column is refused, naming it. `nextly migrate:create` judges this against the configuration it compiled itself.

`nextly plugins uninstall` now finishes where the plugin added a column or index to a collection's, Single's, field group's or core table. The app's migrations carry those, so no module of the plugin removes them: the uninstall leaves them in place and forgets they were the plugin's, so the app's next change removes them, asking for the data-loss consent. Before, it was refused as having nothing to undo them, or after its DOWNs ran. The refusal a development push gives over a removed plugin's part (put the plugin back, uninstall it, take it out, apply the change again) now works as it says.

`nextly prune` removes a plugin's collection whose table holds a column or index the same plugin added; another owner's part still refuses it. A Schema Builder save bringing a table no migration records up to date no longer offers to remove another owner's recorded column or index as something an earlier version left, and keeps them. A file that drops a collection's table whole takes with it what a still-configured plugin no longer declares there.
