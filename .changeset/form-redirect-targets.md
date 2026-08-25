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

Form redirect targets: list them by the field each collection configures, project the read, mark what is not published, and refuse only the pairing that would send a visitor to a missing page.

The picker listed target documents by a fixed set of fields, so a collection that names its documents through `admin.useAsTitle` — `headline`, say — showed opaque ids and an author could save a redirect to the wrong page. It now reads each collection's configured title field. The same request sent its field projection in a form the API discards, so every scalar and JSON field of up to fifty documents came back per collection; for page-builder targets that is the whole block tree. The projection is now encoded in the form the API accepts.

Unpublished pages stay in the picker on purpose — a form is usually configured beside the page it points at — but they are now marked, and saving is refused only when a form that accepts submissions points at a page that has never been published. A draft form pointing at a draft page saves normally, since the two go live together. The rule is judged on the state a write leaves behind, so it also catches publishing a form over such a target in a later save, and it covers both settings that can name a page rather than only the picker's own.

A collection that publishes per locale is left alone: a page whose translation is public still reads as a draft on its main row, so neither the marker nor the refusal treats it as unpublished.
