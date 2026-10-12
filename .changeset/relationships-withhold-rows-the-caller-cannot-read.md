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

Populating a relationship now withholds a related row from a caller who could not read that row directly.

- A scoped API key needs `read-<collection>` in its own scope to see rows of a related collection, whatever that collection's read rule says. Before, a key granted only the parent collection was shown related rows whenever the related collection declared no read rule or its rule admitted.
- A signed-in user reading a related collection that declares no `access.read` rule now needs a read permission on it, the same one a direct read of that collection asks for. Before, any signed-in user who could read the parent was shown those rows. Collections that do declare `access.read` still let that rule decide, with no per-collection permission required.

**Upgrading:** a relationship whose target collection has no `access.read` rule now comes back unpopulated for users and API keys that lack read permission on that collection. Grant `read-<collection>` to the roles and keys that should see those rows, or declare an `access.read` rule on the collection.
