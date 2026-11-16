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

Field groups now store the data fields placed inside a group with no name. A group with no name only lays fields out, and everywhere else its fields are stored where the group sits; in a field group that is the instance's own row. Before, the field group's table had no column for such a field, its value was dropped on write, and a read never returned it. Now the creator, the desired table a save or `nextly migrate:create` diffs from, the instance write and read (a relationship's expansion at depth included), and reconcile all read the same walk, so each such field is a column of `comp_<slug>` and its value is stored and read back. A field group placed inside such a group keeps its instances in its own table, as before.

Compatibility: field groups made with an earlier release have no column for these fields. Their next save in the Schema Builder, or the next `nextly migrate:create`, writes a migration that adds each missing column, nullable, and changes no existing column. Where the table was made before Builder saves wrote migrations, the save's review now names each column it adds, for you to confirm. Until that migration is applied, such a field group is read and written as before, without those fields. Reconcile keeps the fields and lists each column still to come (`awaitingColumns`) instead of removing them, and a reconcile of a field group holding a group with no name no longer fails.
