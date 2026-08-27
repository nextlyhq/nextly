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

A document whose blocks field was never written no longer keeps class-usage rows it does not earn.

The index left a subject's rows alone whenever the read answered nothing, and that rule is right for
one reason only: absence cannot be made definite, because a read hook can withhold a row and nothing
distinguishes that from a document that is gone. Retaining over-counts, which refuses a delete that
was safe, and the next rebuild corrects it.

That justification covered less than the branch did. The read also answered nothing when the row
arrived and its blocks field held nothing - and `blocksField` declares no default, so the column
starts empty and stays that way until something saves it. Every such document kept whatever classes
it last had, and each of those rows blocked a deletion for a page that referenced nothing.

A row that arrived with an empty field is now answered as an empty document, which is the definite
reading it deserves: it reconciles to no rows and the stale ones go. Absence still means no row at
all, and still leaves the subject alone. The two were only ever conflated because they arrived as
the same value.

Nothing distinguishes them by convention - the separation is structural. A field cleared in the
editor stores a document with no nodes rather than nothing, because `BlockDocument.nodes` is not
optional and the commit path cannot express the alternative.

A field that was not RETURNED is a third state and is left alone. An `afterRead` hook replaces the
record and may project a field away, which core supports, so the key can be missing from a document
that still applies every class it did before. Only an explicitly stored null is read as empty;
a missing key is indeterminate, and treating it as empty would remove a live document's rows and
let the safe-delete check take a class its pages still render.
