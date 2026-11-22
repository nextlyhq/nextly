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

A relationship or upload that holds a list of links (`hasMany`, a list to several collections, or a many-to-many) can no longer be marked unique, on any database. "Unique" on a list would mean no two entries hold the identical list, which is rarely what is meant, and PostgreSQL refused to save such a list once it held about a hundred ids. Each database used to treat the mark differently. Now every one refuses it before anything changes, naming the field and the fix: turn Unique off, or make it a single link (`UNIQUE_NOT_ON_LIST`).

The refusal comes wherever the field is declared. The Schema Builder refuses the save of a collection, Single or field group with such a field. A collection or Single defined in code is refused at start, as any other invalid config is.

What an existing site sees: a list relationship already marked unique is now refused at save and at start, until Unique is turned off on it. A site whose migrations recorded such an index is told to run `nextly migrate:create`, which writes its drop.
