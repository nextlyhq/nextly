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

Translators get a page of their own. `Translations` in the sidebar lists what
needs translating in one language, across every collection at once — the
question every existing surface could only answer one document at a time, which
meant opening every document to find the work.

It is the way IN rather than a second editor: choosing a row opens the document
in the editor that already exists, in the target language, with the source
beside it.

When the server could not consult every collection, the page says WHICH. A
worklist that quietly omits a collection reads as "nothing to do there", and
that is indistinguishable from the truth at a glance.

`PaginationMeta` gains an optional `notConsulted`, omitted by every read that
consults everything — so its presence is the signal, and no existing response
changes.
