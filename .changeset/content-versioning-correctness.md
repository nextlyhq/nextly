---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Content version snapshots are now captured more faithfully: component subtrees and
relations are read within the write transaction so just-written data is included
correctly on every database (no leaked password hashes, no lost ids), a partial
translation edit keeps the language's other translated fields in the snapshot, and
publishing all languages records a version and fires the status-change events like
an ordinary publish. Publishing or changing the status of a single translation now
also fires the document status-change events, tagged with the language. A versioned
Single that is auto-created on its first read now starts its version history at that
moment instead of leaving the live document without any version.
