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

The page builder now reads the document a class-usage subject names, in the lifecycle state and
the language that subject is keyed by.

Neither variant is read through a lifecycle filter, and that is the correction at the centre of
this change. An explicit status is a CONJUNCTION: the list service constrains the main row and
then hands the same value to the localized companion's own status, so a document has to be in
that state twice over to be returned. Three real states satisfy neither side of it - a
translation unpublished while the default stays published, the inverse, and a collection with
status enabled whose draft split is ineligible and whose single row happens to be a draft - and
each of those was indexed nowhere, so a class used only there passed the safe-delete check.

Both subjects are read by id instead, which applies no lifecycle filter for a trusted caller,
and they differ only in whether they opt into the working draft. A draft subject takes the
sidecar overlay when there is one, identified by its marker, and records nothing when there is
none - a document with no pending edits has no draft content to describe. The published subject
takes whatever row exists, whatever state that row is in, which is where a document that has
never been published gets indexed at all. Where no sidecar exists the two subjects therefore
describe the same document, and the published one carries its classes. That over-counts against
a draft that was never separately edited, and over-counting is the direction to fail in: it
warns about a delete that was safe, where the filter permitted one that was not.

A subject with a real locale asks with FALLBACK OFF. Fallback is on by default, so a language
with no translation resolved the field from its fallback chain, and the resulting classes were
filed under a translation that does not exist. Every subject derives from its own stored
translation, or the per-locale model the reconciler and the rebuild share stops being true.

A read that cannot be performed RAISES instead of answering empty. Errors are never suppressed,
so a failing read hook - or a document a read hook narrowed away - comes back as an unsuccessful
result rather than as nothing. This matters because absence is treated as a reason to leave a
subject's rows alone: that protects the classes already indexed, but does nothing for a class
the current save introduced, which would have no row to protect and would be indexed nowhere.
A withheld document is now reported to the caller instead of counted as absent.

An absent document leaves that subject's rows ALONE. Absence cannot be made definite through any
read available to a plugin, so the asymmetry decides it - keeping a row that should have gone
overcounts, so the UI warns, a deletion is refused, and the next rebuild corrects it; deleting
one that should have stayed undercounts, so the class reads as unused, the safe-delete check
permits it, and the pages that render it lose it. Only one of those is recoverable. Rows for a
variant that has genuinely gone are removed by the rebuild's sweep, which walks the documents
and can tell them apart.

A document that does not identify itself as the subject's is refused, and its rows are left
alone. Neither end of the read can be trusted on its own: a `beforeOperation` read hook may
rewrite the queried id and the service builds its predicate from the rewritten one, so asking
about a document is not the same as being answered about it; and `afterRead` replaces the
document, so a collection may rewrite or drop the id for reasons unrelated to which row was
read. A returned id that differs is therefore either a legitimate reshape or another document
entirely, and nothing available to a plugin distinguishes them.

The asymmetry decides it rather than a guess about which hook is likelier. Reconciling an
unconfirmed document files ITS classes under this subject and removes the rows the real document
earned, so a class that document still renders reads as unused and becomes deletable. Refusing
costs a maintenance pass: the rows stay, the index over-counts, a delete is refused, the caller
is told, and the next rebuild corrects it.

The cost is worth naming plainly. A collection whose `afterRead` rewrites or strips the id
cannot have its class usage maintained, and every save on it reports a maintenance failure. That
is a loud, diagnosable refusal instead of a silent corruption.

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
