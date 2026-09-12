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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
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
---

A many-to-many field's junction table is now followed by the table itself, not
by the field that names it. A junction name reused for a field pointing at
another collection is dropped and created again — before, `CREATE TABLE IF NOT
EXISTS` kept the old table and its old link column. Changing a field's
`junctionTable` renames its table with the links in it, and pointing a field at
another collection gives it a new table instead of none. Two many-to-many fields
cannot store their links in one table, whether the name is the author's or the
generated one, and a save that would move a junction off a table another field
still uses, or onto one that already exists, is refused by name.
