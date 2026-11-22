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

The Schema Builder judges a field moved to another level, and a copy's name, by the save's own field-name rule rather than its own list. A move out of a group to the top level is refused for a built-in column's name, for `status` or `first_published_at` while Draft/Published is on, or for a column longer than 63 characters. `title`, `slug` and `status` with drafts off now move as the save takes them. A copy's number moves past a built-in or Draft/Published name as well as a sibling's.

A Builder save sends every field's name as it is stored. A plugin's camelCase `metaTitle` used to be sent as `meta_title`, renaming the field's API key on an unrelated save. A name off the Builder's spelling, as an older draft may hold, is now refused by the save, naming the field, rather than renamed.
