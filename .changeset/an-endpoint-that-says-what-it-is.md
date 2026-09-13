---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
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

`@nextlyhq/plugin-mcp` corrections, and two package summaries that said the
opposite of what the package does.

The npm description and the root package catalogue still described the package
as a placeholder serving no endpoint, which is what a reader discovering it
through the registry or through an indexed README was told. Both now say what it
is.

`path` refuses a value that cannot address a single endpoint — a missing leading
slash, a trailing one, a `:param` pattern, or the mount itself — at the moment it
is written rather than as a 404 to explain later. Its documentation also now
says what it cannot promise: a path Nextly itself serves will not reach the
endpoint, because core answers first, and that precedence is deliberate.

Authentication runs before the endpoint's address check, so a request carrying
no credential is answered `401` whatever address it used. That is written down
now, in the package and in its README, rather than left for a reader to discover
from a status they did not expect.
