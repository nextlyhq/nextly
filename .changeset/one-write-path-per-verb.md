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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Creating, updating and deleting an entry inside a transaction ran through two
implementations: one for a caller that owns the transaction, and a separate
streamlined copy the batch services call per item. The copies had already
drifted — a truncated comment on one side, a differently worded error message,
and a first-publication marker whose rule had to be restated for the batch path
after it was found missing there. Each verb now has ONE implementation that both
entry points delegate to, so the two cannot disagree again; the things that
genuinely differ between them (whether the collection-level access check runs
here or was hoisted to a batch caller, whether user hooks run, and which shape
of the row-ownership gate applies) are named options on that one path rather
than two bodies kept in step by hand.

No behaviour changes. Every public method keeps its signature, and the batch
services are untouched.
