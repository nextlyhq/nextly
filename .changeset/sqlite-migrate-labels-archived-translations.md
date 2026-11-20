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

On SQLite, `nextly migrate` now labels archived translations with the entity that owns them, as it does on PostgreSQL and MySQL. It skipped that on SQLite while registry rows could carry timestamps in milliseconds. The repair of those timestamps now runs first in the same run, so an entity whose registry row a migration file of an earlier release wrote is repaired and has its archived translations labelled by one `nextly migrate`.

If that repair fails, the run warns and the next start runs the registries' repair again. Where the run would label archived translations of unknown kind, it then stops before it writes the registry rows, as it does when the labelling fails: written anyway, the write would remove the registry row of an entity the applied migrations dropped, and that entity's archived translations could then never be labelled. The next `nextly migrate` repairs, labels and then writes. Where it would label nothing, it carries on.

The labelling now leaves the archived translations of an entity whose registry row's creation time cannot be read as a date unlabelled, for a later run, instead of settling them as unresolved for good.
