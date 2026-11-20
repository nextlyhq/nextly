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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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

On MySQL, a Schema Builder save that deletes a field's values now holds its collection from its count of those values until its migration is over, as a collection delete does, so a value written while the save runs is either counted (and the save refused for the new count) or written after the field is gone; before, an entry write that was under way when the save counted could be dropped uncounted. The admin's Schema Builder now sends the counts its review showed with the save, so its deletions are counted and held this way; a count that changed since the review refuses the save, naming the new count. An entry write to a collection now waits while another change of that collection holds it, a hold that waits past 30 seconds is refused before anything changes, and a write that waited while its collection was deleted, or deleted and made again under its slug, is refused rather than written into what took its place. A collection delete or entry write that meets a schema change in progress now answers `COLLECTION_BEING_CHANGED` (409) instead of `CONFLICT`, so a caller can tell the refusal is safe to try again. The hold also costs fewer statements: the database's name is read once per connection pool, and its named locks are taken in one statement and released in one. A hold that fails part way releases every lock it may have taken.
