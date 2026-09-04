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

The activity feed obeys a collection's stored read rule, and no longer publishes
a count it cannot authorize.

Its scope was collection-level, and `entryTitle` is stored on the log row at
write time rather than hydrated through the read path — so nothing between the
table and the response consulted a document rule. Under a stored `owner-only`
or `custom` read rule the feed reported other authors' entry titles, entry ids,
and the names and email addresses attached to their edits. Measured: with the
ordinary read returning one document for the caller, the feed returned four
rows spanning both authors.

Each row's document is now authorized as the caller, by the same decision the
pending-edit cards use — one implementation, so the two surfaces cannot come to
different conclusions about who may see a document. A stored rule can be an
arbitrary function and its constraint is expressed over the collection's own
fields, which an audit row does not carry, so the constraint cannot be pushed
into this query the way it is pushed into a collection read; asking the read
path about a known set of ids is the one form that works for every rule.

Rows that name no document keep their existing treatment: a settings mutation
is filed under a namespace that is neither a collection nor a single, the
caller's scope already admitted it, and dropping those would remove credential
rotations from the feed entirely.

`total` is gone from the response. It counted the rows the collection scope
admitted, so it reported edits to documents the reader may not open — the same
disclosure the rows carried, in a number — and it cannot be narrowed without
authorizing every matching row, which is unbounded over a table that only
grows. `hasMore` carries the pagination instead, observed by authorizing one
row past the page. The hand-written `COUNT(*)` behind the old field is removed
with it.
