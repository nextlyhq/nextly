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

Give a custom collection edit view the same document claim the default editor
takes.

A collection registering `admin.components.views.Edit.Component` returns its own
view before the entry form mounts, and the form is where the default editor
claims. So those views announced nothing to the lock: a colleague opening the
same document was told nobody held it, and the editor was shown no holder and
offered no takeover, on precisely the documents a project cared enough about to
build a bespoke editor for.

The claim is now taken above the branch, and the lock banner renders beside the
scheduled-release banner already there, which the page renders on that branch for
the same reason: a custom view replaces the form, not the facts about the
document.

The view is also handed what the claim withholds, through the props every custom
edit view already receives rather than an admin-internal hook it cannot import.
The banner says in words that unsaved changes cannot be saved while a colleague
holds the document, and a view that wrote anyway would make that sentence false
and would overwrite the holder's row. The bundled form builder reads it, so its
save is withheld and its Save button says so.

The claim is taken only once the document is actually on screen. Taken while the
entry is still loading, or after it failed to load, it would heartbeat a document
the editor is not looking at, and colleagues would be told this person is editing
a page that never appeared for them.

Only that branch claims. The form still claims for the default editor, and
claiming in both places would put two claims on one document under one author.
The condition is the resolved component rather than the registered path, because
a path that resolves to nothing falls through to the form, which has its own
claim.
