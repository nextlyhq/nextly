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

A production start no longer writes the registry, the permissions, the roles or their grants, or the user field definitions, and no longer marks an entity migrated. Every start used to write the registry rows of your collections, Singles and field groups from the configuration of the build that was starting, seed the permissions and preset grants before `getNextly()` resolved, and mark a plugin collection's table `applied` though it lacked the plugin's new column. So whichever build started last decided what the database said, an older one included, and a start ran a few statements for every collection, Single and permission. A production start now serves what `nextly migrate` (and a plugin's install and uninstall) wrote, and runs the same number of statements however many entities the site has. A development start (`next dev`) keeps its live sync, unchanged.

Run `nextly migrate` before serving. The scaffolded build script already runs `nextly migrate && next build`; a deployment that relied on its start to bring a new field, collection or permission into the database must now run `nextly migrate` first. Until it does, a read or write that reaches a declared field the database has not been migrated for answers `ENTITY_NOT_MIGRATED`, naming the field to trusted server code. With `db.runMigrationsOnBoot`, the start runs `nextly migrate` first and gets the same.

Moving production back to a Nextly release from before this one is outside this guarantee: such a release seeds the permissions and preset grants at every production start, from its own configuration and presets, and has no setting that turns that off.
