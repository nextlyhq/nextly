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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

Publishing or unpublishing chosen parts of a document from the admin carries
only what the dialog described. A description (`describe: true`) answers the
version it was made from, and the dialog sends that one back: a change saved
since, in any of the chosen languages or what they share, is refused. The
dialog then describes the parts again, names the one that changed, and
publishes only once it is confirmed again. Before, it sent a version read as
it was confirmed, so a change made after the description went live under it.

`nextly.publish()` and `nextly.unpublish()` with `describe: true`, and the
REST routes, answer that version as `_rev`, and `marks`, which say which part
differs between two descriptions. Both are experimental.
