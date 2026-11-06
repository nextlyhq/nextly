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

`updateIfUnchanged` (`@experimental`) now refuses, with `INVALID_INPUT` and before anything is written, data naming a key no update stores: a system column no client writes (`updatedAt`, `createdAt` and the like), a column a schema hook contributed, or a field stored nowhere. A field group or a many-to-many, which an update stores in their own tables, is taken as before. The check runs in the update itself, once its access is judged and before any hook, so a caller who may not update the document is refused alike whatever the data names. A field kept in its own table is taken under its declared name only. An update drops such a key and writes the rest, so the conditional write would have landed in part while reported as made whole. The version (`_rev`) and overwrite (`_overwrite`) keys are still taken.
