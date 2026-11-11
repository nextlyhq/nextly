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

`nextly migrate` now writes the registry rows of collections, Singles and field groups from the migrations, under the schema lock, after its migrations apply. Each row is brought to the newest applied snapshot that records every entity's declaration, whether the entity is defined in code, in the Schema Builder or by a plugin, and a row that already matches is not written. A field added in code therefore reaches the registry when `nextly migrate` ends, before any start. Rows of entities that snapshot does not record, and fields the running configuration lacks, are left as they are; a run whose later migration fails still writes the rows of the ones that applied. A snapshot written before declarations were recorded is read as saying nothing, so it rewrites no row. The development boot keeps inserting only missing rows, since its start keeps them in step with the code.

A field group whose label, description or admin options alone change now has that change written, as collections and Singles already did; a description or admin block the declaration no longer has is cleared.
