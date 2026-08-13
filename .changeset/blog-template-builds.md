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
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Repair the blog template so a scaffolded project type-checks and builds.

A new blog project failed its build at the search-index step: it has no posts,
so Pagefind indexed nothing and exited non-zero. The empty case is now reported
and skipped, while a real Pagefind failure still stops the build.

SQL statement splitting no longer tracks string state through comment text. An
apostrophe in a retained comment opened a string that never closed, which merged
every following statement into one that SQLite rejects.

The query layer narrows documents with runtime-checked readers instead of
asserting them to its domain types, and a collection can declare defaultColumns
in code as the admin and the visual schema already allowed.
