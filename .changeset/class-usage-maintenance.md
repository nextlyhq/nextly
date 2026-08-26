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

The page builder can now rebuild the class-usage index from the documents it describes.

The index is a CACHE of something derivable, and that is the only reason it is allowed to
exist: the answer is always recoverable by walking the documents again. This is that walk.
Documents written before the index existed have no rows at all; a write that bypassed
maintenance leaves rows that disagree with the document; and maintenance runs after the
document commits, so a failure there leaves the document saved and its rows stale. None of
those is visible from the rows themselves.

It walks ordered by `id` rather than by anything it can change. Offset paging reads position
N of an ordered set, so ordering by a mutable key while writing during the walk reshuffles
rows between queries and skips some - and `updatedAt`, the obvious ordering for a
maintenance pass, is exactly the key each write moves.

It stops at the first failure. Swallowing one and continuing would report a completed
rebuild that repaired nothing, which is the report that stops anyone looking. Stopping is
affordable because reconciliation is idempotent: a rerun writes the same rows.

`scanned` and `repaired` answer different questions, and `undetermined` is separate from
both: a scanned document answered, and an undetermined one did not.

Beneath it, maintenance brings one document's rows into agreement with it. Reconciling
rather than replacing matters because the table is read constantly: between a delete and a
re-insert the document appears to reference NOTHING, so a usage count read in that window
reports zero and a safe-delete check performed in it gets the one answer that permits the
deletion. Inserts are issued before removals for the same reason at a finer grain.

A document that cannot be read whole contributes one marker row and nothing else, whose
class id is longer than the engine's cap so it cannot collide with a real reference. The
prefix it managed to read is discarded, because reconciling against a prefix removes the
rows for every reference past the bound.

A rebuild is not subject to the race the write path will have: reconciliation is sound only
when its caller visits a subject once at a time, and a rebuild does so by construction. That
property has to be arranged by whatever wires this into writes, and is recorded where the
diff is computed.
