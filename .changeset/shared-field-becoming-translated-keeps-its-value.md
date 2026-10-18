---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

A shared field that becomes translated keeps its value, as the default language's translation, for a collection, a Single or a field group.

- The Schema Builder's settings save lost the value: a Single's dropped it with the shared column, and a collection's left that column behind, so a Required field refused every later entry. The value now moves to the default language's row before the shared column is removed.
- The schema dialogs asked to confirm the shared column's removal as a loss, and lost the value when it was confirmed. They now move it and apply without asking.
- `nextly migrate:create` planned the change as the whole entity becoming translated, and the migration failed on the existing translations table. It now writes one file that adds the translated column, copies each value and removes the shared column; `nextly migrate:down` makes the field shared again with the default language's value and archives the other languages.
- A field whose type, length or precision changes in the same change is refused, naming the two saves that work, since its value would be copied into a column of the new shape.
