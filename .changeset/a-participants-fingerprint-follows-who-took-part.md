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

`ctx.publicAddresses.fingerprint()` now also changes after a start that ran with another set of plugins taking part in keeping public addresses unique (`@experimental`). A plugin disabled, removed from the config, uninstalled, or switched off by a config reload in development reaches no save while it is not running, and when it came back its stored fingerprint still matched, so it skipped its catch-up and its record stayed blind to those saves. Nextly now keeps the set each start ran with, and a count that goes up when it changes, in one `nextly_meta` row; the fingerprint includes the count. A start reads the row with the meta rows it already reads, and writes it only when the set changed, so a start with the same plugins as the last costs nothing more. On upgrading, the first start of a site whose plugins take part records them, and their next catch-up runs in full once.
