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

A draft subject is resolved by asking twice, because two different stored things are both
drafts and no single column distinguishes them. A document published and edited since keeps
its main row published and its pending edits in a sidecar, and only the by-id read overlays
that sidecar - so it is asked first, and its marker identifies the overlay. Everything else
that is a draft is a stored row whose lifecycle state says so, and the list read's status
filter is the only thing that can name it: it is authoritative and it also constrains a
localized companion's own status, which is what makes a per-locale draft addressable at all.

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

Two kinds of draft that no marker can identify now record their classes. A document that has
never been published has no sidecar to overlay, so its main row is itself the draft and
nothing marks it. A non-default language that was explicitly unpublished while the default
stays published moves the companion's status to draft and deliberately leaves the main row
published, so the entry's own status column answers about the entry rather than about the
translation being asked for. Both were refused, and the published read excludes both by
definition, so a class used only on a page still being written - or only on an unpublished
translation - was recorded under neither subject and the safe-delete check reported no usage
for it.

A read that answers with a different document than the one asked for is refused. A predicate
is a request rather than a guarantee: a beforeOperation or beforeRead hook may replace the
supplied filter or clear it outright, and the query service honours that deliberately, so the
first row of the page can belong to another document. Filing its classes under this subject
would also remove the rows the real document earned, and a class that document still renders
would then read as unused and become deletable. The returned row's id is checked against the
subject, and a mismatch is reported as a read failure rather than reconciled - answering
nothing would be indistinguishable from an absent document, which deliberately leaves rows
alone and would report a subject as reconciled that was never reached.
