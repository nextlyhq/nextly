---
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Saving a document now refuses a link whose `entryId` is bound to a related entry's `id` (for example `author.id`) while its Linked collection (`entryCollection`) is not the collection that relation points at, or is not set. Such a link would look the entry up in the wrong collection and silently draw no link. The refusal names both collections and the one to set. A stored page that already held one keeps saving, with a warning. `@nextlyhq/blocks-engine` gains the issue code `binding-entry-collection-mismatch`.
