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

A required relationship or upload on a collection now gets a NOT NULL column from `nextly migrate:create`, as the Schema Builder's create already gave it, and turning `required` on or off is planned as a change to the column. A collection's required relationship whose column was created nullable gets NOT NULL on the next migration; it is refused, naming the rows, if any entry has no value.

In the Schema Builder, making a collection's relationship required now makes its column NOT NULL, where the save succeeded and left it nullable, and is refused with the same message while an entry has no value in it.

A translated many-to-many on a translated Single now gets its join table when a schema save adds it, moves to a new one when its target changes, and loses it when the field is removed.

A Single's relationship or upload column accepts an empty value even when the field is required, because the Single's one entry is created on its first read before anything is chosen. The requirement is still checked when the entry is saved. A Single made in the Schema Builder with a required relationship can now be read for the first time, where it failed. Unless the field states otherwise, deleting the entry it links to now empties the link (`set null`) instead of refusing the delete. A Builder Single created before this keeps its NOT NULL column, and `nextly repair-columns` reports it as a NOT NULL drop.
