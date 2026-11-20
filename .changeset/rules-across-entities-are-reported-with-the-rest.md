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

The configuration's rules across entities are reported with every other problem in it, each at its place: two collections, Singles or field groups with one slug, two field groups whose slugs make one table, two Singles at one public address, and field groups that place each other in a cycle. Before, `defineConfig` threw on the first of these while the configuration file was imported, so nothing else was reported. Compatibility: `defineConfig` no longer throws for these four rules; every command refuses them with the rest (`CONFIG_INVALID`), and a running site's start refuses them, for entities written as plain objects too, as `defineConfig` did. Its other rules (the users block, localization, workflows) still throw. Also: a `define*` collection whose public address names its system `slug` is still refused when it declares no field of its own; a cached configuration from a `-c` file since removed no longer answers a command that reads entities; and relationships nested in a group, repeater or layout field are collected with the rest, so a Builder entity the definition file lost is found through them, with or without plugins.
