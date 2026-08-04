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

`ctx.services.collections` now returns rows typed by their collection.

The methods are generic over the slug and resolve through the types `nextly generate:types`
writes, so `createEntry("posts", …)` hands back a `Post` rather than a record with an `unknown`
index signature. The Direct API has always worked this way; the plugin path did not, which is why
plugin code asserts a row into its own document type — and why those assertions cannot be checked,
an index-signature record and a concrete document having no overlap for TypeScript to verify.

An app that has not run codegen gets the loose record it gets today, exactly as the Direct API
falls back. Nothing breaks and no new step is required.

This is type-level only: the runtime proxy is unchanged. Plugin code that already stores a row in
a variable typed as its own document may now need to drop an assertion that TypeScript reports as
unnecessary.
