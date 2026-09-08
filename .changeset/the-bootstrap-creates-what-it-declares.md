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

Forty-three added in total: twenty-eight on tables the bootstrap already
created, and fifteen on `dynamic_collections`, `dynamic_singles` and
`dynamic_components`, which are now created too. A UNIQUE constraint the DDL
already spells inline — on the column, or as `UNIQUE(a, b)` at the end of the
table — is the same index under a name SQLite chooses, so those are recognised
rather than emitted a second time; a named index beside one builds a second
B-tree over the same columns for every write.

Only `dynamic_singles` was entirely absent — nothing creates it outside tests.
The other two are created by `SystemTableService`, which the same fallback calls
next, but from its own hand-written DDL that has 19 columns on PostgreSQL and 21
on SQLite where the schema declares 25. Those definitions disagree with the
schema and with each other. The statements added here are generated from the
Drizzle column configs and run first, so on SQLite the complete definition is
the one that wins.

These statements now also reach databases that already exist. The caller
returned as soon as it saw a `users` table, so the only path that ran them was
the one taken by a database that did not exist yet — leaving `nextly db:sync`,
the documented recovery command, unable to supply anything added since an
install was created. An existing SQLite database is reconciled instead; every
statement is IF NOT EXISTS, so re-running adds only what is absent. A table
whose COLUMNS drifted is not repaired this way, since SQLite skips a CREATE
TABLE wholesale once the table exists.

The guard that was meant to catch this could not see two of the tables. It read
the schema SOURCE for a literal table name, and `dynamic_components` is built
by a factory from a computed one, so it was absent from every comparison and
passed by absence. It now walks the dialect bundle — the same object graph the
ORM writes through — and a new integration test executes the DDL against a real
SQLite database and reads the indexes back, rather than comparing two strings
drawn from the same repository.
