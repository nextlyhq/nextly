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

Add the document soft lock's server half: a lease on one entry, its heartbeat, its expiry and its sweep.

Two authors opening the same entry previously overwrote each other in silence — there was no lock and no `updatedAt` precondition, so the second save won and neither author was told. `nextly_document_lock` now holds one row per document being edited, and `acquireDocumentLock`, `renewDocumentLock`, `releaseDocumentLock`, `readDocumentLock` and `sweepExpiredDocumentLocks` take, keep, give up, observe and collect a claim.

Every liveness comparison is a SQL expression the database evaluates itself, on its own clock. Contenders sit on different instances whose clocks disagree, so a claim written from one clock and judged against another is decided by that skew rather than by who holds the lock.

A claim identifies an ACQUISITION rather than a person: each carries a token minted when it was taken, and every heartbeat and release must present it. One author with the document open in two tabs holds two claims under one user id, and a release from the closed tab must not free the claim the other tab is still editing under.

A lease lasts 150 seconds and its holder confirms every 15, both derived from one TTL. Expiry alone releases a claim, so a holder that crashed or went offline does not lock a document indefinitely, and a person may deliberately take over a live one.

The HTTP surface that exposes this is not included, so no behaviour changes for a user yet.
