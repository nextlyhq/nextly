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

The entry list shows which languages a row is missing.

Two surfaces were answering "how far along are this document's translations"
separately and disagreeing: for an entry with only its default language written,
the editor's language panel read "1 of 3 translated" while the list's badge read
"0/2". There is now one derivation, and it excludes the default language on both
sides — that is the source a translation is made FROM, not one of them.

The list's count is replaced by one mark per translatable language. A count says
how much is left and never which, so choosing what to translate next meant
opening rows to find out. Each mark carries its language and state in its
accessible name, and the row carries a spoken summary naming exactly what is
missing.

That column also never actually appeared. It had been added to a second,
unreferenced column builder that no table has called since the list moved to its
current one, so no user has seen it. The live builder now renders it and the
dead one is gone.
