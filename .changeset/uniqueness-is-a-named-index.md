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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

A column declared unique now gets a named unique index instead of an unnamed constraint written into the table itself.

An unnamed constraint is one the database names for you, and on SQLite that name is internal and cannot be referred to. Nothing could describe it afterwards, so the schema Nextly compared against never matched the table, and the only way SQLite could reconcile the two was to rebuild the whole table. Nextly refuses a rebuild it did not ask for, so the entire change was refused with it, including the parts that were only adding things. It also made such a column impossible to remove.
