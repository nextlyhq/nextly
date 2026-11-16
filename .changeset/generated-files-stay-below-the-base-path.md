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

Two files Nextly writes now go below the root its services were registered with (`basePath`), as its generated migrations and schemas already did, rather than always below the working directory: the migration log (`.nextly/logs/migrations.log`), and an upload to local disk for a collection with no storage plugin (`public/uploads`, with the `.gitignore` entry kept beside it). An app that passes no `basePath` to `getNextly` has the working directory as its root, so nothing moves; one that passes a `basePath` now finds both below it, beside the migrations it already generates there. The test harness gives each instance a folder of its own, so a plugin's integration tests no longer leave `public/`, `.gitignore` and `.nextly/` in the package they test.
