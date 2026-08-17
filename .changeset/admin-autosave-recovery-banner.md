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
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

feat(admin): offer recovered work back when an editor opens

Recording without offering is a loop that never closes: the work was stored and
nobody was ever told it existed. The entry editor now reads the calling author
own recovery point on open and offers it back.

A non-blocking strip above the fields rather than a modal. A modal suited the
older local draft, which was almost always your own work from a tab that had
just crashed. A server recovery point is a wider set, including work from
another device or from days ago, so demanding an answer before the document can
be read turns a rescue into an obstacle.

An offer is withheld when the document was saved after the recovery point, and
made anyway when the document timestamp is unknown: a spurious offer costs one
dismissal, while a suppressed one loses work recorded specifically so it could
not be lost.
