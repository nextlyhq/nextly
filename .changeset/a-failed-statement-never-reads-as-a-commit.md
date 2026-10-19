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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

On PostgreSQL, a transaction that a failed statement had aborted was reported
as committed. PostgreSQL does not refuse a COMMIT sent after a failure: it
rolls the transaction back and answers with the ROLLBACK command tag, raising
no error. So a callback that caught a failed statement and returned saw
`transaction()` resolve while none of its writes were kept.

**The PostgreSQL adapter's `transaction()`, and so `ctx.db.transaction`, now
rejects in that case**, with a `DatabaseError` (`code` `25P02`): an error now
replaces a silent rollback. `ctx.db.raw.transaction` is Drizzle's own
transaction and is unchanged. Code
that catches a failed statement inside a PostgreSQL transaction and carries on
will see the transaction fail where it used to appear to succeed. Nothing it
wrote was ever kept, so no data changes; only the report does. A bulk create
or update without `stopOnError`, in which one item's statement failed, now
reports every item failed, which is what was kept, where it used to count the
items before the failure as saved. A statement
that may fail, and that the rest of the work should not depend on, belongs
outside the transaction.

One core path did exactly that. A plugin that reports a person deleted inside
`ctx.db.transaction`, and then sends the person an email naming them, has the
email's record written inside that same transaction. The recorder never fails
a send, so when that insert failed (a provider removed between the send and
its record, a lock timeout), it caught the failure and carried on. On
PostgreSQL the commit then rolled back the plugin's deletion, the audit
erasure and the deleted-person record, while the plugin was told all three had
committed. The person was never erased.

A core record written inside a plugin's transaction (an email delivery or an
audit row naming a plugin-defined person) now runs under a savepoint of its
own on PostgreSQL. Its failure is rolled back to the savepoint and the
plugin's transaction stays usable, so the deletion commits. If rolling back
would also undo a write the plugin started while the record was being written,
the transaction is failed instead, so no write the plugin was told about is
lost unseen. MySQL keeps a transaction usable after a failed statement and has
no savepoints in this adapter, so nothing changes there.
