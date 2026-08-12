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

`@nextlyhq/plugin-sdk` now exports `pluginAdminSlug`, `PLUGIN_CATEGORIES` and `isPluginCategory` (experimental), so a plugin author can derive a plugin's admin slug and check a category against the vocabulary `definePlugin` accepts, rather than reimplementing either. They are also on `nextly` and `nextly/config` for host apps.

The admin uses those exports instead of its own copies. It previously derived a plugin's URL slug with its own implementation of core's algorithm, so a plugin page could be linked at one slug and routed at another the moment either side changed, and it kept its own list of valid categories, so it could reject a category `definePlugin` accepts.

Nothing changes in the admin UI. The plugin directory that consumes these is not built yet; this is the groundwork it needs.
