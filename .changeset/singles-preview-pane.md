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

A Single can now be edited beside the page it becomes, the same way a collection
entry can.

The split-view preview shipped for entries and stopped there, so the same author
doing the same job got two different experiences depending on which kind of
document they had opened: an entry could be previewed in place, while a Single
offered only "copy a shareable link". A Single has a draft lifecycle, an address
on the site and a credential that reaches it — everything the pane needs — so the
gap was in the wiring rather than in anything a Single lacks.

Nothing was duplicated to do it. The pane, the credential's renewal timer, the
cross-origin refusal and the one-session-per-browser warning are the same code
serving both, because a second pane for Singles would have been a second
implementation of all four, agreeing until one of them was edited. What changed
is that the pieces now take a SCOPE — a collection entry, or a Single — instead
of a collection name and an entry id.

The preview and the shareable link beside it resolve that scope ONCE. Both need
a language claim and both are wrong in the same way without one: on a localized
Single opened in its default language the editor's active locale is absent, and
an absent claim covers every translation rather than the default. Two surfaces
resolving that separately would agree on the day they were written, so they now
share one answer, and the pane is offered on exactly the terms the link is.
