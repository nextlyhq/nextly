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

The variant is named through the LIFECYCLE FILTER rather than the by-id read's draft flag. That
flag is documented as effective "only on a drafts-enabled, non-localized collection", and
drafts and localization are not mutually exclusive - so on a localized collection it did
nothing and every draft subject silently read the live row. The filter is authoritative and
also constrains the localized companion's own status, which is what makes a per-locale draft
addressable at all.

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
