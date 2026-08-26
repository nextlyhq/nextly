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

The page builder can now rebuild a COLLECTION's class-usage rows from its documents.

A collection with drafts holds TWO documents under one id, and they can apply different
classes: a pure draft edit leaves the live row untouched, so the published page and the
pending draft disagree until somebody publishes. The key therefore carries a `variant`
alongside the locale, and a rebuild of one variant leaves the other's rows untouched.
Counting both is deliberate - deleting a class an unpublished draft applies breaks that
draft the moment it is published.

The variant selects the DOCUMENT that is read as well as labelling the rows it files, and
both dimensions are required on the store contract for the same reason: a store that cannot
be told which one to read answers both passes identically, which records the published
classes as the draft's and omits the ones only the draft applies. It is a closed set rather
than free text, because a value outside it produces rows that no query built from a real
subject can select - neither to reconcile nor to sweep.

Two limits are worth stating, because "the index is recoverable" is wider than what this
rebuilds. It repairs one collection's field at a time, so rows whose subject names a
collection that no longer exists - or whose columns were corrupted by a restore or a
direct write - are unreachable by every query it makes and survive a pass it reports as
clean. Removing those needs the set of ALL live subjects, which is the caller's knowledge
rather than this module's.

Scoped to collections deliberately: the index models single subjects too, and a plugin has
no supported way to read a Single's document - the one readable path creates the row when
it is absent, so a sweep over Singles would materialise every Single in the app while
appearing to work. Singles gain a rebuild when that reader does.

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

The existence check the sweep makes is asked in the SAME locale and variant as the rows it
decides the fate of. A document's published and draft forms come and go independently -
discarding a working draft leaves the published document untouched - so a check asking only
whether some document has that id answers yes for a draft that is gone, and its rows survive
every future pass. Nothing else could remove them, because the sweep is the only mechanism
that can and it would be the one unable to see the difference.

Rows whose document no longer exists are swept: a document deleted through a path that
bypassed maintenance never appears in the walk, so its rows would otherwise survive a
rebuild that reported success. The sweep runs only after the walk completes, since against a
partial one it would delete the rows of every document not yet reached.

The bounds a rebuild derives under are REQUIRED rather than optional, on every entry point a
caller invokes. Omitting them is not neutral: the derivation falls back to the engine
defaults while the host may have configured others, and the two directions fail in opposite
ways - raised bounds record a document the renderer draws whole as an undetermined marker
instead of its classes, and lowered bounds count classes on nodes the page never draws.
Passing the engine defaults explicitly is still available and is now a decision rather than
an omission.

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
