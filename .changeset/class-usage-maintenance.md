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

The page builder can now bring a document's class-usage rows into agreement with the document.

Given a document and the subject it belongs to, this derives the rows that document should
have and applies only the difference. Reconciling rather than replacing matters because the
table is read constantly: between a delete and a re-insert the document appears to reference
NOTHING, so a usage count read in that window reports zero and a safe-delete check performed
in it gets the one answer that permits the deletion.

Inserts are issued before removals for the same reason. Between the two statements the index
reports the subject as referencing both what it did and what it now does - an over-count,
which warns about a delete that was safe. The other order reports it as referencing neither.

A document that cannot be read whole contributes its marker and nothing else. The prefix it
managed to read is discarded rather than written, because reconciling against a prefix
removes the rows for every reference past the bound.

A deleted document's rows are dropped outright. Without that a deleted page's references
outlive it, and a class it was the only user of never reaches zero - so an author is warned
about documents that are gone and can never delete the class.

Nothing calls this yet. It is written to run from a collection's `after*` hooks, which is
forced rather than chosen: a row id does not exist until the insert has happened, so no
pre-write phase can name the document it would be indexing. Those phases run POST-COMMIT, so
a failure there cannot roll the document back and must not be raised as one - reporting a
failed save for a save that succeeded is the most confusing direction a failure can take.
The rebuild is what repairs the record instead.
