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

The admin's collection and Single lists (`/collections` and `/singles` with a page, a size, a search or a sort) are now answered from the registry listing each server copy already holds, instead of a count and a page query on every request: a dashboard, list or edit screen sends 4 to 6 fewer statements, and none for an unchanged registry. The reader's permissions still decide what is counted, so a total never includes a collection or Single the reader cannot see. A change is seen at once on the server copy that made it, and within 2 seconds on any other, as every registry read is.

The collection list's search now behaves the same on every database: a case-insensitive match on the slug and description (PostgreSQL matched case-sensitively before, so searching "Post" now also finds "posts"), with `%` and `_` matched as the characters they are rather than as wildcards. Sorting by name compares slugs character by character on every database, where the database's collation decided before.
