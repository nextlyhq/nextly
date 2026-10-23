---
"nextly": patch
"@nextlyhq/plugin-accounts": patch
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
"@nextlyhq/plugin-commerce": patch
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

Filtering by a date works on SQLite. A filter on `createdAt`, `updatedAt` or a date field with an ISO 8601 value used to answer 500 on SQLite, the admin's Created and Updated filters on every list among them. It now narrows the list and its count, as it does on PostgreSQL and MySQL.

A date is compared with an instant with its offset (`2026-09-01T09:00:00Z`) or a calendar date (`2026-09-01`, the start of that day in UTC), read the same way on every database. Any other value, including a time with no offset, is now refused with `400 FILTER_INVALID_OPERAND` on every database, where PostgreSQL and MySQL used to pass it to the database to interpret.
