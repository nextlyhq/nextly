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

A Builder save the process left part-way inside a migration file on MySQL is now settled at the next development start, or the next save of the entity, to what the database holds: the file and snapshot are written for exactly the changes that applied, recorded applied, and the definition and registry row brought to that shape, each change named applied or not. A definition edited meanwhile is kept and named. A save whose file changes rows of its own (a fill, a delete, a moved field's values) is never judged from the tables and is kept as part-applied rather than withdrawn. The settle now runs the migration history's checks before its first write, and records each file it adopts with the checksum `nextly migrate` checks.

While such a save stands unsettled on MySQL in development, a write that sets a field whose columns the tables no longer hold as the registry row declares them is refused (`BUILDER_SAVE_FIELD_UNSETTLED`), naming the field, with nothing of it applied. Writes that set no such field go on, and reads are answered from the tables. A stop is judged with the entity's translations table beside its main table, so an entity that keeps its translatable values per language is settled too, where the save changed its main table in one file.
