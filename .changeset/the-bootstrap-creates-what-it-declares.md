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
---

The SQLite bootstrap DDL now creates the indexes it declares, and the three
schema-registry tables it never created at all.

This DDL runs where drizzle-kit's push cannot — no TTY, no interactive
confirmation — so it is the path taken exactly where nobody is watching. A
missing index breaks no insert; it makes every query against that column a
scan, which is why fifty of them were declared on all three dialects and
created on none.

Fifty added in total: thirty-five on tables the bootstrap already created, and
fifteen on `dynamic_collections`, `dynamic_singles` and `dynamic_components`,
which are now created too. Those three hold the metadata for every collection,
single and component in a project, so a database built from this fallback
previously could not describe its own content.

The guard that was meant to catch this could not see two of the tables. It read
the schema SOURCE for a literal table name, and `dynamic_components` is built
by a factory from a computed one, so it was absent from every comparison and
passed by absence. It now walks the dialect bundle — the same object graph the
ORM writes through — and a new integration test executes the DDL against a real
SQLite database and reads the indexes back, rather than comparing two strings
drawn from the same repository.
