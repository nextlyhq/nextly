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

The Direct API now follows the stored schema version as the admin API does: before a collection or Single operation, and before each form and field group call, a server copy reads the stored version (at most once every 2 seconds, sharing the read) and loads its definitions again when another copy changed the schema. Before, a process that served no admin request, such as an instance that had only rendered site pages since it started, or a script, kept the definitions it started with for as long as it ran, so a field added elsewhere was never read and a removed one failed its reads. Nothing is read inside an open transaction.

Deleting a collection's or Single's registry row now always moves the stored schema version, including the orphaned collections and Singles `nextly db:sync --remove-orphaned` deletes, so a running dev server stops serving a deleted collection or Single within 2 seconds rather than at the next unrelated schema change.
