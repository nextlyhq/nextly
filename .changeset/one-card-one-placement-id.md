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

A saved dashboard whose stored arrangement holds one placement id twice keeps working, instead of the reader losing every card they arranged.

The endpoint has always refused a submission that reuses a placement id, but a row that already held a duplicate — written before that guard, or by anything other than that endpoint — was handed to the admin intact, where the id is the React key and the identity the drag-and-drop sort resolves by; the first match wins there, so a duplicate silently drags the wrong card. Such a row is now resolved when it is split by what the reader may see, so what one reader is handed never depends on a card another reader hid, and the id a repeat is given is derived from the id it repeats rather than minted fresh — the same row answers the same ids on every read, so a client that echoes what it was handed keeps each card's column. Refusing a write and resolving a read now come from one shared analysis rather than two copies of the same rule, and a row that keeps arriving malformed is logged with the id, since nothing on the reader's screen will ever say so.
