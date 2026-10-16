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

A translated field that is made shared now keeps its content. Its default
language's value becomes the shared value, and every other language's value is
written to the localization archive before the translated column is removed;
before, every language was dropped with the column. This holds for collections,
Singles and field groups, through the Schema Builder's save and its schema
dialog.

The change is refused before anything is altered when the archive cannot be
written, when the field is Required or Unique, which its new shared column
cannot satisfy until the values are copied into it, and when the same edit
changes how the field is stored (its type, length or precision); the message names the order that works.

`nextly i18n:restore --field <name>` brings one field's archived values back
once it is translated again, by the field's name or its column name; a value
archived more than once comes back from its newest row.
