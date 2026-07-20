---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Content version history can now be read, and it no longer grows forever.

Two new endpoints list a document's versions and fetch a single one, and the same
surface is available to plugin code. Listing returns metadata only, so opening a
long history never transfers the stored content.

Version history is also bounded now. A collection or single keeps the number of
versions you configured instead of accumulating one for every save ever made; the
limit was previously accepted in configuration but never applied. The newest
version and the version matching your currently published content are always
kept, and trimming happens as part of the same save, so history can never be left
in a half-trimmed state.
