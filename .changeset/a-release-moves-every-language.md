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
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
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
"create-nextly-app": patch
"nextly": patch
---

Move every language of a document when a scheduled release runs. A release member that names no language means the whole document, but the write took that to mean the default language: a scheduled takedown pulled the main row down and left every translation live, and reported success while doing it — so a page could read as unpublished in the admin while its German version was still being served. A scheduled publish had the mirror problem, putting the document live with its translations still held back.

The selector is the wildcard locale the i18n layer already defines, and it rides the ordinary write path rather than a second one. That matters more than it sounds: the ordinary path is what authorizes the transition, runs the collection's hooks, folds in any pending working draft and records the outbox event, and a materialiser routed around it would publish different content than the same publish performed by hand. Singles behave the same way, because a release member holds either kind.

The wildcard moves a publication status and refuses anything else. "Write these values into every language" is a different and far more destructive operation than "move this document's lifecycle across every language" — it would copy one translation's prose over all the others — so a wildcard write that names any other field is rejected rather than narrowed, and says so.
