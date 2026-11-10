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

A one-to-one relationship is now unique exactly while it is one-to-one, on every road. A save that makes a column unique (marked Unique, or a relationship becoming one-to-one) while its entries already repeat a value is refused before anything runs, naming the field and how many values repeat, where the Schema Builder's apply used to fail part-way; entries that point at nothing never count as repeats. The Builder's preview now says when a field's column will be made unique or will stop being unique. On SQLite, a save no longer adds a second unique index to a column an inline UNIQUE already enforces. A relationship the earlier Schema Builder stored as one-to-one (`options.relationType: "oneToOne"`) is unique in the files `migrate:create` writes, and the Builder now opens it with its target and Unique set, so saving it unchanged keeps it one-to-one; before, it opened with no target and Unique off. The Builder creates a one-to-one's uniqueness as the named `uq_<table>_<column>` index a field marked Unique gets.
