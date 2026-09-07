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

Claim a document only when the caller may actually update that row.

`/api/document-lock` authorized writes on `update-<slug>`, which is the coarse
route permission: it says a caller may update documents of this kind, not that
they may update THIS one. A collection carrying an owner-only or role-based
stored rule refuses the row while that permission still stands, so a non-owner
could take a claim on a document every real update denies them, and the
legitimate owner was then shown a false holder and pushed to take over their own
row.

The gate the version routes already run for the same reason now runs here too. It
was named `assertVersionDocumentUpdatable` and is renamed to
`assertDocumentUpdatable`, since it was never about versions: its own docblock
describes the document's update rules, and it now has two callers.
