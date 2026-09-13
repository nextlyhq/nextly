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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

Refuse to fill a declared slot whose name cannot be stored, and derive the
expansion depth from the document's own limit.

A block supplied to the inserter rather than registered never passes
registration, so the slot-name rule enforced there did not reach it: a slot
named for an `Object.prototype` member was filled, the op layer rejected the
resulting node, and the author's click did nothing with nothing reported. The
same predicate now answers on both paths.

The expansion also carried its own depth bound alongside the document model's,
and the lower of two policies silently wins — a declaration nesting nine
containers is legal by the document model and was truncated. The bound is now
derived from `MAX_DEPTH`, less the root the caller creates.
