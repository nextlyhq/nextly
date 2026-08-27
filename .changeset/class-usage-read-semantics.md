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

The document's identity is taken from the read that was ISSUED rather than from the row that
came back. A by-id read pins the entry in its own query, and `afterRead` may legitimately
replace the document - a collection that reshapes its public read can rewrite or drop the id
entirely. Comparing the returned id against the requested one would reject those collections on
every maintenance pass, and a class introduced by such a save would receive no row at all. The
refusal that does still apply is on the index's own list reads, whose predicates a hook can
widen, and where a row outside the query is another document's.
