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

A translated field marked unique is now unique within each language. The same value is refused twice in one language, as a duplicate of a shared unique field is (409 `DUPLICATE`), and allowed once in each language. A value left blank is never a duplicate, and nothing stored changes: the rule is an index on each translations table, keyed on the value with blanks left out, so every read returns what it did before.

Every way of declaring the field enforces it. The Schema Builder adds the index when it creates a collection, Single or field group, and adds or drops it when a field becomes or stops being unique. `db:sync`, and the reload under `next dev`, do the same for fields defined in code. `nextly migrate:create` writes a migration that adds or drops it, so production gets it with `nextly migrate`. Until the index is there, each start names the field and the commands to run.

Adding the rule is refused before anything changes where it cannot hold:

- where a language already holds a value twice, naming the documents in each language but never the value (`TRANSLATED_UNIQUE_OVER_DUPLICATES`). The Schema Builder refuses the save. `db:sync` reports it and leaves that field without its index. `nextly migrate` stops at that migration file before running any of it, so nothing is half-applied, even on MySQL;
- on a database server that cannot build the index (`UNIQUE_NOT_ENFORCEABLE_ON_DIALECT`): MariaDB, and MySQL before 8.0.13.

Give the listed documents different values, or leave one blank, and run it again.

Before this, a translated unique field was not enforced at all. A field already marked unique and translated gets its index the next time its entity is saved in the Schema Builder, or from the next `db:sync`, or from the next `migrate:create` and `nextly migrate`. Each of these is refused, as above, if a language already holds a value twice.

The migration files that add or drop these indexes are a new kind, so their header is version 4. An older version of nextly refuses to run them and says to upgrade, rather than running them wrongly.
