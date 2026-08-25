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

Move `authoredBreakpoints` and `inCascadeOrder` from the page-builder editor
into the blocks engine, beside the `BreakpointDef` and `BreakpointSet` types
they operate on.

Both answer questions that the stored record does not: which rows an author
actually defined — a stored set may carry a reserved `base` row that the
compiler prepends regardless — and the order in which the cascade applies them.
More than one package now asks, so a second implementation would agree about
what a breakpoint means while disagreeing about which rows exist and in what
order they apply.

The editor re-exports both, so every existing import keeps working.
