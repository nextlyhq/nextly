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

A Schema Builder save that changes the type of a field inside a named group or a repeater judges each value the field holds, as it judges a field kept on the row. Nothing converts a value held inside JSON, so a value is kept only where the new field reads it as it is stored. Where a value cannot be read as the new type, or would first have to be rewritten into its form (the text "1" under a number field), the save is refused before anything changes, naming the field by its path (such as `details.price`) and the rows by their keys with a count, never by their values. The schema dialog, the collection update and `nextly migrate` give the same judgement in the same words. Before, the save went through and left those values in the group's or the repeater's stored JSON under a type that cannot read them.
