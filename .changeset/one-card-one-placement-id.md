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

A saved dashboard whose stored arrangement holds one placement id twice is repaired on read instead of being thrown away.

The endpoint has always refused a submission that reuses a placement id, but a row that already held a duplicate — written before that guard, or by anything other than that endpoint — was handed to the admin intact, where the id is the React key and the identity the drag-and-drop sort resolves by. Reading such a row now re-keys the later placement and keeps the arrangement whole, rather than reporting the row unreadable and dropping the reader back to the default order; the repair is logged with the id it fixed, so a row that keeps arriving malformed is still visible to an operator. The endpoint's own check and the reader's now ask one shared question instead of two copies of it.
