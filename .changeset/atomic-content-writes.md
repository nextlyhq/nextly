---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Content writes now commit their relationships and component data in the same transaction as the entry.

Creating or updating an entry now writes the entry, its component data, and its many-to-many relationships in a single database transaction. Previously the relationship writes ran after the transaction had already committed, so if they failed the entry was left behind without them; now such a failure rolls the whole write back. Single-document updates likewise write the document and its component data in one transaction, so a component failure no longer leaves a half-updated document.
