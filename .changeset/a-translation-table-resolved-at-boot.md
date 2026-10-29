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

After a restart, a delete inside a plugin's own transaction, opened by `ctx.services.collections.withTransaction` or by `ctx.db.transaction`, is now judged by a delete rule's filter on a translated field. Before, such a delete was refused, even for an entry the filter matched, until some earlier write or read had looked at the collection's translation table, because a write inside a transaction cannot look that table up itself.

At boot, Nextly now looks up each translated collection's, Single's and field group's translation table once, in the background. Startup doesn't wait for it; it costs one database look-up per translated entity. Until it finishes, such a delete is refused as before. A look-up that fails is logged and skipped.
