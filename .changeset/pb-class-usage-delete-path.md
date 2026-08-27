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

Deleting a document now removes the class-usage rows it owned.

Until now the index only ever learned about writes. A deleted page's rows stayed behind and kept
counting towards their classes, so a class that nothing rendered any more could never be deleted -
the safe-delete check reported usage by a document nobody could open. The rebuild's sweep could
reach some of those rows but only within one collection, field, locale and variant at a time.

This is the one place in the write path where absence is definite. Everywhere else, whether a
document is there has to be answered by reading, and a read cannot answer it: a list read applies
beforeOperation and beforeRead regardless of access override, so a tenant scope or a soft-delete
filter withholds a live row and the page comes back empty, indistinguishable from a document that
is gone. That is why an absent document otherwise leaves its rows alone. Here nothing is inferred -
the hook is the notification that the row was removed, and it runs after the delete committed.

Removal is bound on the document and deliberately not on field, locale or variant. A delete removes
the document in every language and both lifecycle states at once, so every subject it owned goes
with it. It also does not consult the collection's configuration first: a blocks field REMOVED from
a collection after its rows were written would make the collection look untracked, and every row
that field ever owned would survive the delete with no document left to reconcile it against.

A failure is raised rather than swallowed, for the same reason a failed save is. The deletion is
already committed and cannot be rolled back, so the throw becomes a warning the caller receives -
and rows that survive a deleted document name a document that no longer exists, so no later write
will reconcile them.

Deletes inside a caller-owned transaction are skipped, as writes are: the hook runs before that
transaction commits and the pooled Direct API cannot join it. Singles and the index's own
collection are skipped for the reasons they already were.
