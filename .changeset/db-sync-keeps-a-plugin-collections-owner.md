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

`nextly db:sync` records a plugin's collections as the plugin's, under the slugs the site renamed them to. Before, it recorded every plugin collection it created as the app's own, and in 0.0.2-alpha.81 each `db:sync`, its watch included, also relabelled the ones a start had recorded correctly. A collection renamed with `renameMap` was recorded as the app's own by a start and a reload too. Once such a plugin left the configuration, `db:sync --remove-orphaned`, given consent, could drop its collections' tables.

If you have run `db:sync` with a plugin that adds collections, run it once more on this release while the plugin is still configured: that records them as the plugin's again, as a development start does. If you have already removed the plugin, `db:sync` names its collections as removed from code; do not run `--remove-orphaned`. Put the plugin back, run `nextly db:sync` once, then remove it. Only collections are protected: `--remove-orphaned` still lists a removed plugin's Singles and field groups. Rolling back a migration that renamed a plugin's collection is unchanged.
