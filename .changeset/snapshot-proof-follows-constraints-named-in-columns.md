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

`nextly migrate` follows more of a hand-written migration before it records one applied without running it. A constraint named inside a column's definition (`author integer CONSTRAINT posts_author_fk REFERENCES users (id) DEFERRABLE`) is checked as one written as its own clause: a PostgreSQL key's deferrability, a MySQL check's enforcement, a unique constraint's index. A later drop removes only an object of its own kind, so a `DROP INDEX` sharing a constraint's name no longer stops the constraint from being checked. A MySQL `CREATE TABLE` that declares an index with a method or order (`INDEX i USING HASH (c)`), or a full-text or spatial one, is refused as the `CREATE INDEX` form is. On SQLite, the `AUTOINCREMENT` counter is compared with the highest key inside SQLite in one statement, exact above 2^53, and a key declared `PRIMARY KEY ON CONFLICT <resolution> AUTOINCREMENT` is read as one. Files `nextly migrate:create` writes are unaffected: where the database does not stand as a hand-written file leaves it, the run stops with `MIGRATION_NOT_PROVEN` instead of recording it.
