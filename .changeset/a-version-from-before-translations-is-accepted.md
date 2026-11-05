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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

An update that hands back its `_rev` is now judged the same way however it arrives (experimental):

- A version a read gave while a collection's or Single's translations were not set up yet names no language. Sending it back with a save in the default language is now accepted, judged on the document's own row; before, it was refused with 400.
- In `updateMany` and the in-transaction updates, a version from another language's read is refused with 400 before any hook runs, as a single save's is.
- Who changed a refused document and when are now told only to a caller whom the collection's or Single's own read rule lets read it, a rule that answers a filter included. Before, any signed-in caller who could update it was told.
- A save in a language other than the default, while translations are not set up yet, is refused with 400 before any hook runs.
