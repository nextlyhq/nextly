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

Hold a plugin's own settings permission everywhere it applies, and seal every stored secret the boot can.

- The settings gate reads the plugin's `settingsPermission` from the route handlers' config, so the first request on a cold process no longer falls back to `manage-settings`.
- `settingsPermission` must be a permission the plugin owns as the permission collector keeps it. A `publish` or `unpublish` declared on a collection or Single, which is that entity's own publish permission, is refused at boot, for a Schema Builder entity too.
- The admin's plugin settings page asks for the plugin's settings permission, which the plugin metadata now publishes as `settings.permission`, rather than always `manage-settings`.
- The boot re-seals a value encrypted under a rotated secret even when the plugin no longer declares any secrets.
- A stored value holding a secret no configured key can open no longer keeps a newly secret sibling in plain text: the sibling is sealed, and the unreadable secret is kept as stored.
