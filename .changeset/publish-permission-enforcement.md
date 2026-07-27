---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
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
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Publishing and unpublishing content are now first-class permissions, enforced
concurrency-safely across every write surface for both collections and singles.

Moving a document into or out of `published` requires `publish-<slug>` /
`unpublish-<slug>` on top of the write permission, so editing and publishing are
separate capabilities. The transition is classified against the status read
under the write's row lock (not a read taken before the transaction), closing
the race where a concurrent writer could move a row into or out of published and
slip a transition past the gate; this holds for single, batch, transactional,
and by-query writes, and for a localized document's per-locale companion status.
A scoped API key is judged on its own stamped grants rather than the key owner's
permissions on every write path (create, update, publish/unpublish, duplicate,
delete, bulk, and version-label edits), and a document-dependent (owner-only or
custom) transition rule is re-evaluated against the row-locked document. An
unauthenticated caller can no longer publish a publicly-writable collection or
single unless an explicit rule allows it.
