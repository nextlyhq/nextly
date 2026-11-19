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

`nextly migrate` records a pending migration as applied without running it only when its snapshot proves the whole file. Three more things are now checked before it does, and the file is refused with `NEXTLY_MIGRATION_NOT_PROVEN` where one fails:

- On MySQL, a column the file restates with `MODIFY` or `CHANGE` must hold nothing the statement would reset: a collation, comment, visibility, `ON UPDATE`, `AUTO_INCREMENT` or generated expression set on it by hand. The statement is marked "the column keeps settings it would reset". A `MODIFY` or `CHANGE` that states one of these itself, or a position (`FIRST`, `AFTER`), is not shown by the snapshot.
- On PostgreSQL and MySQL, a table the file creates with a key the database assigns (`serial`, an identity column, `AUTO_INCREMENT`) must have that key assigned in the database. A table made by hand with a plain integer key is no longer taken for it.
- On SQLite, rows that reference missing rows are counted against the foreign key they dangle through. A file that adds a second key between two tables is no longer refused for rows dangling through the key the database already had.
