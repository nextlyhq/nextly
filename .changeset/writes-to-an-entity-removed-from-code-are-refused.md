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

A collection or Single removed from your configuration is now read-only. While its registry row says your code defines it and `nextly.config.ts` no longer declares it, every write to its entries is refused, through the admin, the REST API, the Direct API, a plugin's content and version-history services, and the release engine: creating, editing, deleting, duplicating, publishing and withdrawing, bulk changes, restoring, naming and pinning versions, autosaves, working drafts and "seen" marks. Nothing about the entry changes, and its entries can still be read while its tables exist. The refusal is a 409 with the code `ENTITY_REMOVED_FROM_CODE`, names the collection or Single, and carries its `kind` and `slug` in `error.data`. Schema Builder and plugin collections and Singles are not affected.

**Compatibility:** a site that still edits a collection or Single removed from code is refused from this release. There are two ways out: declare it again in `nextly.config.ts` to keep it, or retire it by running `nextly migrate:create` and then `nextly migrate`, which drops its tables.
