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

A project made from a template has its schema changes since the template named. `nextly migrate` reads the snapshot a template ships (a list of its collections and Singles with their top-level fields) as the tables those entities were made with. A collection, a Single or a field group added since is named as a change with no migration, and so is a top-level field added to or removed from a listed entity once the project declares it; before, nothing was named. An entity the template lists that the project does not declare is left as the template made it and is never read as removed, so a project made with the Schema Builder approach, which declares none, migrates as before. `nextly migrate:create` starts from the same reading and writes that change alone, where before it refused the template's snapshot as invalid, and `nextly migrate:check` reads it too and passes over the template's own migration, which has no recorded hash, where before it failed such a project with a missing or invalid snapshot. The comparison is by name: a change to a listed field's type or options is not seen until the first migration is written. Also, a column the app's own migrations added to one of Nextly's tables (a field added to `users`, say) and since lost from the database, or lost with the whole table, is named by `nextly migrate` as missing, where before the run reported the database up to date.
