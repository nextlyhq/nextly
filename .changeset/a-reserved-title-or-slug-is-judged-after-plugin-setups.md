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

A code-first collection or Single whose plugin leaves a component, a many-to-many or a virtual field named exactly `title` or `slug` is refused when the configuration loads, as one its author declares already was, whatever the plugin's setup did with the field Nextly adds: removed it, made it virtual, or swapped the author's own text field for another. The message names the field, and says so where a plugin's setup left it that way and the app's own configuration does not hold it. A setup that only removes the added field, or replaces it with a text one, is accepted as before.

In a collection with `files`, a field without a column that takes the name of one of the file fields (`storageKey`, `filename` and the rest) is refused too, with its own advice, to rename it, and the same answer whether or not a plugin ran.

This also corrects the reason given with the refusal in 0.0.2-alpha.81, which said a write could be lost. Beside a component of that name no entry can be created, and a stored title or slug reads as nothing. A virtual field's type is applied to the value of the system column: a date replaced the title or slug on PostgreSQL and stopped entries being created on SQLite and MySQL, and JSON or rich text on `title` made filtering by it find nothing; text, textarea, number, checkbox and select showed no harm in the same checks, which did not cover the admin.
