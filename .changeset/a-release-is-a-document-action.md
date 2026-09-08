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

"Add to release" is now a document action like any other, and says why when it
cannot be used.

It was an untyped `ReactNode` slot on the entry and single forms, filled by a
component that rendered its own button. That shape decided four things it had
no business deciding. It was always a toolbar button, always leftmost, and
could not be moved. It could not be ordered against the built-in actions, so a
plugin's contribution and the page's had no defined sequence. It could not
carry a reason, so it returned `null` in three separate places — an author
without the document's publish grant, or editing a translation, saw nothing at
all, which is indistinguishable from a site with no releases feature. And its
width was what pushed Save under the version-history panel, because an
unplaceable control still changes where the placeable ones sit.

The page now contributes a DESCRIPTION paired with a handler, and the model
decides the rest: this belongs in the overflow menu beside Duplicate, because
scheduling a release is a document-management act rather than a leading one.

Existence and usability are now different questions. Authority over the
FEATURE decides whether the action exists — a caller who may not assemble
releases, or a document type with no publish lifecycle, has nothing worth
naming. Facts about THIS DOCUMENT decide whether it can be used, and those
appear disabled with the reason attached rather than vanishing.

A built-in wins an id collision, and one function decides both the action list
and the binding map. Splitting them would let the bar draw a built-in verb
wired to a contribution that lost its collision — Delete, from the model, with
its danger styling and its permission reason, running somebody else's handler.
Nothing about that looks wrong on screen.

The old trigger's hazard is retired rather than restated: it sat inside the
editor's own `<form>`, where a `<button>` with no `type` defaults to `submit`,
so opening the dialog once saved the document and published dirty fields before
anyone had chosen a release. A menu item is not inside the form and runs a
callback, so the shape cannot recur.
