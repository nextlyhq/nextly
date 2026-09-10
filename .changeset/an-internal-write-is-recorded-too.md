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

A missing dashboard service no longer fails a content write.

The audit recorder asks the container for that service, and a container reports
an absent registration two ways: by throwing, and by answering `undefined`. Only
the throw was handled, so the second walked past the catch that exists to keep an
audit failure from failing the write, and died on a property access instead. "No
dashboard service registered" became a FAILED CONTENT WRITE.

The activity feed also names a system actor as "System" instead of rendering a
blank author. Nothing writes those rows yet, and this release does not start:
a write that names no initiating user is still not recorded, because a plugin's
`init()` hook runs before pending migrations do, and an insert against a table
that has not been migrated yet would take the boot down with it. The column can
already hold the value, so the reader handles it rather than showing an empty
author for every import and job the moment something does.
