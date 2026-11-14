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

Collections and Singles now take a group with no name. Such a group only lays out the fields inside it, and those fields are stored as columns of the entry's own row, which is where entries already read and write them.

Before, every builder of a table's columns tried to read the group's missing name and crashed with `Cannot read properties of undefined (reading 'replace')`. This affected the table create, the table change, the runtime table and the desired schema a migration is diffed from. A Single holding such a group could not be created or changed. A collection holding one in the definition file stopped every later Schema Builder save.

All of these builders now read the group's fields as columns of the row. A later save's migration adds or changes only what changed, and the rest of the save reads the group's fields the same way:

- rename detection and the checks run before a save;
- relationship keys;
- field-group row moves;
- a Single's first-read defaults, `select` reads, versions and field-group values.

Field groups keep their own rule: the fields inside such a group get no column. A field-group change that adds a relationship there now saves instead of failing.
