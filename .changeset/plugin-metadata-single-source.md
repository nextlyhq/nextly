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
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

A plugin's slug, category vocabulary, icon and description now have one source each.

`nextly/config` exports `pluginAdminSlug`, `PLUGIN_CATEGORIES` and `isPluginCategory`, and the admin uses those rather than its own copies. Previously the admin derived a plugin's URL slug with its own implementation of core's algorithm, so a plugin page could be linked at one slug and routed at another the moment either side changed; and it kept its own list of valid categories, so it could reject a category `definePlugin` accepts.

The plugin directory now prefers an installed plugin's own icon and description over the catalogue's, per field. A plugin that is installed describes itself; the catalogue only speaks for plugins that are not. The Page Builder and Form Builder catalogue icons also now match the icons those plugins declare.
