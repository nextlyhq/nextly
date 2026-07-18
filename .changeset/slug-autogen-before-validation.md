---
"nextly": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/ui": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"create-nextly-app": patch
---

Auto-generate a collection entry's `slug` from its `title` before validation.

Every collection carries an auto-injected required, unique `slug`. Creating an entry with only a title (`create({ data: { title: "Hello World" } })`) now derives the slug (`hello-world`) and dedupes repeats (`hello-world-2`, …) instead of failing with "Slug is required." An explicitly provided slug is still respected and sanitized. This matches the WordPress/Ghost slug-from-title convention and restores the intended behavior after server-side write validation began running ahead of slug generation.
