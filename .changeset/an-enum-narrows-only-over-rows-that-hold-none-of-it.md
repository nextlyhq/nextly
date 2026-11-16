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

A schema apply that takes a value away from an enum column while a row still holds it is now refused before anything runs, naming the table, the column, the values the rows hold and how many rows hold them — instead of failing at the database after the old check's drop had already run, with an error naming none of them. A narrowing no row holds applies as before. The refusal also follows a column renamed in the same apply, and a value MySQL reports escaped, such as one holding a backslash.

On MySQL, which commits each schema statement on its own, a check that is replaced now runs as one statement per table, drops and adds together, both when a development push applies it and in the files `migrate:create` writes. A row the new check refuses then fails the change with the old check still in place, rather than leaving the column unconstrained, and two checks that exchange names apply where they used to fail. A migration file keeps the old check through a rename or a type change of its column and replaces it afterwards, so a narrowing that fails leaves the renamed column still constrained.
