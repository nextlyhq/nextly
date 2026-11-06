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

`nextly repair-columns` now works out how each differing column would be converted, from the live table, and changes only the column's type and nullability: its default, comment, collation, generated value and position, and the table's indexes, keys, checks, triggers and views stay as they are. Where the new type cannot keep one of them (for example a PostgreSQL view that reads the column, a MySQL index on a column becoming JSON, a default the new type cannot hold), the column is reported as blocked, naming what is in the way and what to change. A collation or character set a JSON column has no place for is named as not carried. The report also says what the conversion costs while it runs. The command still changes nothing.

On SQLite, a generated migration that rebuilds a table now refuses before anything is dropped when a view reads the table, with a message saying to drop the view, migrate and create it again. Before, the same migration failed partway with "error in view ...: no such table".
