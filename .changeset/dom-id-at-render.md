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
---

Let each block claim its own DOM id at render, instead of reserving ids in advance.

Which node ends up writing an id is only knowable once a block has run: one that throws, or returns something with no host root, is replaced by a placeholder that emits no id at all. Reserving ids before rendering therefore meant a block that later failed had already taken the id, and the healthy node that wanted it rendered without one in exchange for nothing.

Node ids are still made unique before rendering. Those are React keys, and a duplicate makes React reuse one block’s instance for another, which is a wrong page rather than a missing anchor.
