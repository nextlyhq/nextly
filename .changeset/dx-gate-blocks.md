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

Blocks now receive a render context, so a block that reads content is an
ordinary async component rather than something the API had no way to express.
A block's `supports` is checked against the style catalog while it is being
written instead of at boot, and a plugin that registers its own support adds it
to that check by augmenting `BlockSupportKeys`. The types a block definition
asks for (slots, examples, editor metadata, node styles) are now all reachable
from `@nextlyhq/plugin-sdk/blocks`, so writing a block no longer means importing
the engine directly.
