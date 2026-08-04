---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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

A string stored in a JSON field no longer fails the write on PostgreSQL and MySQL.

A field backed by a JSON column accepts any JSON document, a plain string included. A string that is not itself encoded JSON was passed through to the driver as bare text, which PostgreSQL and MySQL reject as invalid JSON, so storing `"hello"` in a `json` field failed the write outright. On SQLite, where the column is plain text, it was stored in a form no read could recover as what was written. Such a value is now encoded, so it round-trips as the string it was.

A string that already parses as JSON is still passed through untouched, so content a previous write encoded is not wrapped a second time.
