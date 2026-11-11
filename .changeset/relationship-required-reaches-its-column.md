---
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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

A required relationship or upload now gets a NOT NULL column from `nextly migrate:create`, as the Schema Builder's create already gave it, and turning `required` on or off is planned as a change to the column. A required relationship whose column was created nullable gets NOT NULL on the next migration; it is refused, naming the rows, if any entry has no value.

In the Schema Builder, making a relationship required now makes its column NOT NULL, where the save succeeded and left it nullable, and is refused with the same message while an entry has no value in it.

A translated many-to-many on a translated Single now gets its join table when a schema save adds it, moves to a new one when its target changes, and loses it when the field is removed.
