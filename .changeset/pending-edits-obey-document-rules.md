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

The dashboard's pending-edit cards obey a collection's stored read rule.

Entity-level access answers whether a collection is in reach; it does not
decide which of its documents are. A collection carrying a stored `owner-only`
or `custom` read rule admits every editor at that check while the ordinary read
path narrows to a subset — so counting and listing version rows filtered by
collection name alone reported one author's documents to another, handing back
their entry ids, languages and the instants they were last edited.

The cards now ask the ordinary read path which of the candidate documents the
caller may actually see, rather than reproducing a rule that can be an arbitrary
function. Singles are asked per language, because a localized Single is a
different document per language and a rule can answer differently for each. A
row whose scope is neither a collection nor a single is dropped rather than
admitted, since nothing can judge it.

A localized document is authorized per LANGUAGE — collections as well as
Singles, because a stored rule is a predicate over the collection's own fields
and a localized field answers differently per language. Rows reach that decision
one per locale and are collapsed to one per document only afterwards.
Collapsing first offered each document's newest locale alone: where that one was
denied and an older one readable, the document vanished from a card its reader
was entitled to see.

Nothing sizes the read from configuration either. The row bound used to be the
install's current locale count, which does not describe the data — working
drafts written under a locale since removed are still rows — so it could fetch
too few rows to find the documents asked for while every check said the answer
was exact. The read is paged instead, and the only bound is how many documents
the caller wants.

A pending row for a Single is checked against the live document's id, resolved
without materializing it. Version rows outlive the documents they describe, so a
Single deleted and recreated leaves rows naming its predecessor — and the read
probe goes through a path that auto-creates a missing Single, which would have
made loading a dashboard perform a write.

Paged reads order by a unique key as well as the instant. `updatedAt` alone is
not a total order, and paging one with OFFSET can return a row twice and skip
another, losing a document that nothing downstream can notice is missing.

That answer cannot be computed in SQL — the rule lives on the collection, the
candidates live in the version table, and the data layer has no join — so an
exact count means considering candidates in memory, which is bounded. Past that
bound the count refuses rather than reporting a number that is quietly too
small.
