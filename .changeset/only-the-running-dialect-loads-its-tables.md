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

nextly's table bundles, per-feature table helpers and core schema now load only the running database dialect's table definitions, where before importing nextly loaded all three dialects'.

The `schema` export, which held all three dialects' tables, is removed from `nextly` and `nextly/database`. Read tables with `getDialectTables(dialect)` after creating the adapter.

Four functions now read a loaded dialect's tables, and throw, naming the fix, if called before that dialect is loaded:

- `getCoreSchema`, from `nextly` and `nextly/schemas`;
- `getStaticRelations`, `getDialectTables` and `getDialectTablesForPush`, from `nextly` and `nextly/database`.

Creating the adapter loads its dialect, so code that runs after that is unaffected. Code that calls them without an adapter, such as schema tooling, first runs `await loadDialectTables(dialect)`, exported from `nextly`, `nextly/database` and `nextly/schemas`.

`new ServiceContainer(adapter)`, from `nextly`, reads its adapter's tables when it is constructed. An adapter made by `createAdapter`, or handed to Nextly's config, is unaffected; one built directly from `@nextlyhq/adapter-postgres`, `@nextlyhq/adapter-mysql` or `@nextlyhq/adapter-sqlite` first needs `await loadDialectTables(adapter.getCapabilities().dialect)`, and the constructor's error names that line. `seedPermissions` and `seedSuperAdmin`, from `nextly/database/seeders`, load the dialect of the adapter they are given themselves.
