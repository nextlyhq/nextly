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

A component being edited previews the edit, not the last published version.

Draft mode previewed the wrong document. A page reads the components it embeds
in one batched query, and the working-draft overlay that surfaces an author's
pending edits is applied only on the single-entry read path — so the batched
query returned the live row however wide its lifecycle scope, and the editor
iframe drew the last published component while the form beside it showed the
edit in progress. The two disagreed about the same document.

`status: "all"` could not fix that. It widens which rows match; it does not
reach a working draft, which lives in a snapshot the list path never consults.

A route serving drafts now reads its definitions one per component, opting into
the overlay explicitly. That read is deliberately not cached, for the reason the
draft entry read is not: a working draft changes on every save while cache tags
are burst by writes to the live row, so a cached draft would show an editor
their previous save and call it a preview.

The cost is one query per component instead of one per page, and it is paid only
where drafts are served — the editor iframe, with one author and no shared cache
entry to protect. Every other route keeps the single batched read, still tagged
per component id, and a route that names `status: "published"` keeps it too:
an explicit lifecycle scope beats the draft widening, in the same order the
overlay rule itself applies them. A shareable preview link is unchanged and
still resolves embedded components to their published versions.
