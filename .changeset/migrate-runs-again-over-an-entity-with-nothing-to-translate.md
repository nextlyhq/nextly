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

A second `nextly migrate` (or `nextly db:sync`) no longer fails on a collection or Single that has no translatable field, such as one holding only repeaters and checkboxes. Such an entity has no translations table to make, and the first run now records nothing for it; before, it recorded a finished move into a table it never made, and the next run refused with "Could not prepare the translations table … An unexpected error occurred".

`nextly migrate` and `nextly migrate:status` also stop warning that a text field of a collection or Single not marked translated "has no column" in its table, and telling you to run `nextly migrate:create`: such a field is kept in the entity's translations table, which is where the check now looks for it.
