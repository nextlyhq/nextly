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

Renaming a text field and making one required now work where its values are kept for each language, the storage every installation runs since per-language storage became the default. The Schema Builder's review offers a text field's rename on its translations table, and the rename keeps every language's value, through the Builder and through `nextly migrate:create` alike, where before the save failed half-applied or the field read empty. A fill or delete answer for a text field made required settles exactly the entries with no value in the default language, on the translations table's default-language rows: the review counts those entries, and the save's migration file and its push settle the same rows. A Single's text field added with a default gives the Single's document that default in the default language. A field group's save settles its answer too, so a delete answer now removes the field group's instances with no value on per-language storage. Where an earlier release kept a repeater, group or component whole in the translations table and the project was adopted with no declarations recorded, removing it and adding a text field in the first run can still be offered as a rename of one into the other; accepted, on PostgreSQL and MySQL `nextly migrate` then refuses the field on every run; on SQLite it holds the container's text as JSON. A migration file records the language its answer is decided in, and `nextly migrate` refuses the file before any statement, with `MIGRATION_LANGUAGE_DIFFERS`, where the project's default language is another one and the answer has entries to settle; a file with such an answer and no recorded language is refused the same way.
