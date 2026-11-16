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

A collection or Single whose definition file holds a group with no name at the top level no longer stops Schema Builder saves. Such a group only lays out the fields inside it, and those fields are stored as columns of the entry's own row, which is where entries already read and write them.

Before, every builder of a table's columns tried to read the group's missing name and crashed with `Cannot read properties of undefined (reading 'replace')`: the table create, the table change, the runtime table, and the desired schema a migration is diffed from. Once such a collection or Single was in the definition file, every later Builder save failed.

All of these builders now read the group's fields as columns of the row. A later save's migration adds or changes only what changed. The rest of the save and of the entry reads and writes take those fields the same way:

- rename detection and the checks run before a save;
- relationship keys and field-group row moves;
- defaults, `select` reads, versions, field-group values, JSON values, dates and relationship values.

**Compatibility:** the Single API now refuses a top-level field without a name, with the same answer the collection API already gives: a validation error, code `REQUIRED`, "Each field requires a name.". This covers creating a Single, saving its schema and applying it from the schema dialog. Before, such a request crashed. A group with no name inside a named group or a repeater stays allowed.
