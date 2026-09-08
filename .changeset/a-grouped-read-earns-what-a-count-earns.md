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

A dashboard widget can now ask how many rows carry each distinct value of a
field, and the answer describes exactly the rows a count of the same query
would have counted.

Both reads settle that row set through one pipeline. Collection access, the
readability guards, the read hooks, release scope, search, translation and
component conditions, the caller's own filter and any constraint a stored
access rule contributes are resolved once, and each operation only decides
what to compute over what is left. An aggregate that assembled its own filters
could describe a wider set than the count beside it, and the two would drift
the first time a condition was added to one of them.

A group key is judged where a filter and a sort are judged, because buckets
are the stronger disclosure: they publish the column's distinct values as the
labels themselves, and redaction never sees them because no row carries the
value. Grouping by a field with a read rule is refused by name. So is
grouping by the owner column, which would report how much each author wrote,
and a key that resolves to no column at all — dropping that would collapse
every bucket into one row and answer with a single total that reads exactly
like a real one.

Buckets are ranked and capped in the database once grouping is complete, so
the cap chooses among finished buckets and never changes which rows were
aggregated. When buckets are left out the result says so, for the reason a
bounded count says `atLeast`: a chart drawn from a silently capped set reads
as the whole picture.

For TypeScript authors, a widget's query now refuses at compile time to pair a
group key with an operation that would ignore it, or to declare the grouping
operation with no key.
