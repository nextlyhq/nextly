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

A field group created where no Schema Builder save writer is set up, and a code-first field group's table created by `nextly db:sync`, now get the same column types as one the Schema Builder creates: the field group's creator reads every column type from the column descriptor. Before, it spelled some of them its own way: on PostgreSQL an email, password, select or radio was `VARCHAR(255)` and a single reference `UUID` where the descriptor says `text`; on MySQL a date was `DATETIME` where it says `timestamp`; a multi-select was JSON and a `hasMany` number a scalar column. Existing tables keep their columns, nothing is migrated, and a field group whose columns carry that earlier spelling still reconciles as healthy. `nextly repair-columns` names such a column as created before 0.0.2-alpha.77.
