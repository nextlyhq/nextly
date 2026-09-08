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

The page builder now says when it is holding work the document does not have.

The editor takes the whole window and asks the admin to hide its chrome, so
nothing outside it is on screen while an author is editing. Inside it, the only
reading was the publish pill — and that pill answers a different question,
"is this page live?", which has no answer on a collection that declares no
publish lifecycle. There it renders nothing, correctly, and took the only
indication of unsaved work down with it. An author editing such a page had
nothing in the toolbar to read at all, while `documentDirty` was already being
computed a few lines away.

Whether work is outstanding and whether the page is live are two questions, so
they are now two readings. The dirty state is derived once and both read it, so
they cannot disagree about it.

The new reading is SILENT when nothing is outstanding, rather than saying
"Saved". The same `false` is produced by a document that was never saved — a
blocks field renders inside a create form and inside previews — so a positive
claim there would tell an author their work was safe on the strength of nothing
having been typed. That asymmetry is the point: the state worth interrupting
someone for is the one where leaving loses something.
