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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

A translation restored from the archive can no longer be left describing itself as current.

Deciding whether a translations table carries the column that records when each language was
last written used to be a question the database was asked indirectly: a statement was attempted,
and any failure at all was read as "the column is not there". A dropped connection, or an
account permitted to write the table but not to read the catalogue, therefore answered the same
way a genuinely older table does — and on that answer a restore preserves the timestamp already
on a language while replacing its content with older archived material, leaving a translation
that reports itself as up to date when it is not.

The question is now answered from the table's own column list. Absent is absent; anything that
prevents the question being answered is reported rather than being turned into a claim about the
schema.
