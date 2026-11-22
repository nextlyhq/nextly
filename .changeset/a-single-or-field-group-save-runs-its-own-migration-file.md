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

A Schema Builder save of a Single or a field group that moves no values now runs the migration file it writes, as `nextly migrate` runs it, instead of the development push. A renamed field keeps everything else about its column (a comment, a collation, a check), a busy table on PostgreSQL or MySQL waits in tries and then stops with `NEXTLY_TABLE_BUSY` (409), leaving nothing behind, and a Single's many-to-many relationship gets its junction table. Saves that carry values across the change (translation turned on or off, a field joining or leaving translation, a translated field renamed or removed, a relationship's storage switched) still run through the push, which now also reports a busy table as `NEXTLY_TABLE_BUSY`.
