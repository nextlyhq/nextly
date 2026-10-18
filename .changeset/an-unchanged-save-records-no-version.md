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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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

A save that changes nothing records no version, on every path, not only on
a working draft: an unpublished document, a collection with history and no
status, a Single, and each language of a translated document. The
comparison is the one a working
draft's save already used, so framework fields such as timestamps don't
count as a change, and now neither do a component's own row timestamps,
which made an unchanged save of a document with a component look changed
whenever it landed in a later second (for a working draft too). A save
that changes only a password records none either: a version never holds a
secret, so it would show nothing. A save that changes the status still records one, and so
do a create, a restore, a named version, and publishing or unpublishing
every language. A save is compared with the document's newest version, and
only when that version is in the save's own language; an unchanged save in
another language still records one, since its own newest version can
predate a change to the shared fields. This takes one extra read of the
document's newest version per save of a document with history.
