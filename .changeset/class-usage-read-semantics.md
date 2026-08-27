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
each of those was indexed nowhere.

Both subjects are read by id instead, which applies no lifecycle filter for a trusted caller,
and they differ only in whether they opt into the working draft. A draft subject takes the
sidecar overlay when there is one, identified by its marker; the published subject takes
whatever row exists. Where no sidecar exists both subjects see the same document and record the
same classes, which over-counts - and that is the direction to fail in, because an over-count
warns about a delete that was safe while an under-count permits one that was not.

A subject with a real locale asks with FALLBACK OFF. Fallback is on by default, so a language
with no translation resolved the field from its fallback chain, and the resulting classes were
filed under a translation that does not exist. Every subject derives from its own stored
translation, or the per-locale model the reconciler and the rebuild share stops being true.

A read that cannot be performed now RAISES instead of answering empty. Errors were suppressed
for every unsuccessful result rather than for a missing row alone, so a failing read hook was
indistinguishable from an absent document.

Each variant is read through the path that can answer for it. A DRAFT goes through the by-id
read, because the pending working draft lives in a sidecar and only that path overlays it - an
already-published document keeps its main row published, so a list read returns nothing for it
and would record a pending draft as applying no classes at all. A PUBLISHED subject goes
through the list read, because only that one carries the lifecycle filter; the by-id path has
no lifecycle parameter, so it would accept a document whose only row is a draft.

An absent document leaves that subject's rows ALONE. Absence cannot be made definite through
any read available to a plugin: a list read applies `beforeOperation` and `beforeRead`
regardless of access override, so a tenant scope or a soft-delete filter withholds the row and
the page comes back empty, indistinguishable from a document that is gone. The asymmetry
decides it - keeping a row that should have gone overcounts, so the UI warns, a deletion is
refused, and the next rebuild corrects it; deleting one that should have stayed undercounts,
so the class reads as unused, the safe-delete check permits it, and the pages that render it
lose it. Only one of those is recoverable. Rows for a variant that has genuinely gone are
removed by the rebuild's sweep, which walks the documents and can tell them apart.

A document that has never been published, and a translation unpublished while its default stays
published, both record their classes now. Neither can be named by a marker or by a status
column: the first has no sidecar to overlay so nothing marks it, and the second leaves the main
row published on purpose, so the entry's status column answers about the entry rather than
about the language being asked for. Both are answered by the by-id read, which asks in the
subject's own locale and filters on nothing.

A withheld document is reported rather than read as absence. Errors are never suppressed, so a
document a read hook narrowed away comes back as an unsuccessful result and is raised. This
matters because absence deliberately leaves a subject's rows alone, which protects the classes
already indexed but does nothing for a class the current save introduced - it would have no row
to protect, and would be indexed nowhere.

A read that answers with a different document than the one asked for is refused. A predicate
is a request rather than a guarantee: a beforeOperation or beforeRead hook may replace the
supplied filter or clear it outright, and the query service honours that deliberately, so the
first row of the page can belong to another document. Filing its classes under this subject
would also remove the rows the real document earned, and a class that document still renders
would then read as unused and become deletable. The returned row's id is checked against the
subject, and a mismatch is reported as a read failure rather than reconciled - answering
nothing would be indistinguishable from an absent document, which deliberately leaves rows
alone and would report a subject as reconciled that was never reached.
