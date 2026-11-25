---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

`nextly migrate` no longer asks for data-loss consent for a hand-written foreign key into another schema (PostgreSQL) or database (MySQL), such as `REFERENCES auth.users (id)`, when the run removes no rows. A table's name before its column list (after `REFERENCES`, in `CREATE TABLE auth.notes (...)`, in `CREATE INDEX i ON public.posts (title)`) is no longer read as a function call; a function really called in the statement still asks. A run that adds such a key and then removes rows names the table whose rows may go.

**Compatibility: a run may now ask where it did not.** PostgreSQL's `TRUNCATE ... CASCADE` empties every table that references the one truncated, whatever the key's `ON DELETE` action. A key with no action that the same run added was not counted, so a run adding a key from `posts` to `users` and then truncating `users` with `CASCADE` emptied `posts` while its consent named only `users`. Such a run now names `posts` too, and `--accept-data-loss=users` alone no longer covers it: name every table listed, or give `--accept-data-loss` without targets, which a table listed with its schema needs. A removal that reaches a live table through a table the same run makes is named as well.
